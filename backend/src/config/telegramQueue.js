'use strict';

const { getPool } = require('./db');

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN || '';
const FALLBACK_ID  = process.env.TELEGRAM_CHAT_ID   || '';
const API_BASE     = `https://api.telegram.org/bot${BOT_TOKEN}`;

const MAX_QUEUE_SIZE     = 500;
const WORKER_INTERVAL_MS = 1100;   // ~1 msg/s per chat to respect Telegram rate limits
const COOLDOWN_MS        = parseInt(process.env.ALERT_COOLDOWN_MS || '300000', 10);

const BACKOFF_SCHEDULE = [10_000, 30_000, 60_000, 120_000, 300_000];
const PRIORITY = Object.freeze({ CAUTION: 1, WARNING: 2, FAILSAFE: 3 });
const MAX_RETRY = { [PRIORITY.CAUTION]: 5, [PRIORITY.WARNING]: 10, [PRIORITY.FAILSAFE]: Infinity };

const queue         = [];
let workerTimer     = null;
let isProcessing    = false;
let isInitialized   = false;
let deadCount       = 0;  // Items moved to DLQ after all chat_ids proved invalid since startup

const cooldownMap   = new Map();

// Write-through persistence to telegram_queue; DB errors log only so delivery never blocks.
function _db(sql, params) {
  let pool;
  try { pool = getPool(); } catch { return; }
  pool.execute(sql, params).catch((e) => console.error('[TelegramQueue] persist error:', e.message));
}
const _persistAdd    = (i) => _db(
  'INSERT IGNORE INTO telegram_queue (id, priority, device_id, alert_data, retry_count, next_attempt_at, created_at) VALUES (?,?,?,?,?,?,?)',
  [i.id, i.priority, i.deviceId ?? null, JSON.stringify(i.alertData), i.retryCount, i.nextAttemptAt, i.createdAt]);
const _persistRetry  = (i) => _db('UPDATE telegram_queue SET retry_count=?, next_attempt_at=? WHERE id=?', [i.retryCount, i.nextAttemptAt, i.id]);
const _persistDelete = (id) => _db('DELETE FROM telegram_queue WHERE id=?', [id]);
const _persistDead   = (id, why) => _db("UPDATE telegram_queue SET status='dead', last_error=? WHERE id=?", [String(why).slice(0, 255), id]);

async function loadPersisted() {
  const [rows] = await getPool().execute(
    "SELECT id, priority, device_id, alert_data, retry_count, next_attempt_at, created_at FROM telegram_queue WHERE status='pending' ORDER BY created_at");
  for (const r of rows) {
    if (queue.some((q) => q.id === r.id)) continue;
    const item = {
      id: r.id, priority: r.priority, deviceId: r.device_id,
      alertData: typeof r.alert_data === 'string' ? JSON.parse(r.alert_data) : r.alert_data,
      recipients: null, retryCount: r.retry_count,
      nextAttemptAt: Number(r.next_attempt_at), createdAt: Number(r.created_at),
    };
    const idx = queue.findIndex((q) => q.priority < item.priority);
    if (idx === -1) queue.push(item); else queue.splice(idx, 0, item);
  }
  if (queue.length) _startWorker();
  return rows.length;
}

const routeCache    = new Map();
const ROUTE_TTL_MS  = 5 * 60 * 1000;

async function resolveRecipients(deviceId) {
  const cacheKey = `device:${deviceId}`;
  const cached   = routeCache.get(cacheKey);
  if (cached && (Date.now() - cached.at) < ROUTE_TTL_MS) {
    return cached.ids;
  }

  const chatIds = new Set();

  try {
    const pool = getPool();

    if (deviceId) {
      const [workers] = await pool.execute(
        `SELECT u.kontak_telegram
         FROM devices d
         JOIN users u ON d.user_id = u.id
         WHERE d.id = ? AND u.kontak_telegram IS NOT NULL AND u.kontak_telegram != ''`,
        [deviceId]
      );
      workers.forEach(w => chatIds.add(w.kontak_telegram.trim()));
    }

    const [admins] = await pool.execute(
      `SELECT kontak_telegram FROM users
       WHERE role = 'admin' AND kontak_telegram IS NOT NULL AND kontak_telegram != ''`
    );
    admins.forEach(a => chatIds.add(a.kontak_telegram.trim()));

  } catch (dbErr) {
    console.warn('[TelegramQueue] DB route resolution failed, using fallback:', dbErr.message);
  }

  if (chatIds.size === 0 && FALLBACK_ID) {
    chatIds.add(FALLBACK_ID);
  }

  const ids = [...chatIds].filter(Boolean);
  routeCache.set(cacheKey, { ids, at: Date.now() });
  return ids;
}

// Failsafe bypasses cache and alerts every registered contact plus fallback.
async function resolveEmergencyRecipients(deviceId) {
  const chatIds = new Set();
  try {
    const pool = getPool();

    const [all] = await pool.execute(
      `SELECT u.kontak_telegram
       FROM users u
       WHERE u.kontak_telegram IS NOT NULL AND u.kontak_telegram != ''
       UNION
       SELECT u.kontak_telegram
       FROM devices d JOIN users u ON d.user_id = u.id
       WHERE d.id = ? AND u.kontak_telegram IS NOT NULL`,
      [deviceId || 0]
    );
    all.forEach(r => chatIds.add(r.kontak_telegram.trim()));
  } catch (e) {
    console.warn('[TelegramQueue] Emergency recipient resolution failed:', e.message);
  }

  if (chatIds.size === 0 && FALLBACK_ID) chatIds.add(FALLBACK_ID);
  return [...chatIds].filter(Boolean);
}

function invalidateRouteCache(deviceId = null) {
  if (deviceId) {
    routeCache.delete(`device:${deviceId}`);
  } else {
    routeCache.clear();
  }
}

function escapeMarkdownV2(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

// Inside MarkdownV2 inline code, only backtick and backslash need escaping.
function escapeCode(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[`\\]/g, '\\$&');
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stripMarkdownEscapes(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function formatAlertMessage(alertData, priority) {
  const level = (alertData.level_peringatan || 'warning').toLowerCase();

  if (priority === PRIORITY.FAILSAFE) {
    const safeNode = escapeHtml(alertData.node_id || alertData.device_id || 'N/A');
    const safeMsg  = escapeHtml(alertData.pesan_notifikasi || '');
    const safeTime = escapeHtml(new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }));
    return {
      text: [
        `🆘🆘🆘 <b>EMERGENCY FAILSAFE ALERT</b> 🆘🆘🆘`,
        ``,
        `⛽ <b>Node:</b> <code>${safeNode}</code>`,
        ``,
        `${safeMsg}`,
        ``,
        `⚠️ <b>Tindakan yang diperlukan:</b>`,
        `1. Periksa mesin diesel secara langsung`,
        `2. Pastikan katup kuras terbuka`,
        `3. Laporkan ke koordinator lapangan`,
        `4. Reset via Dashboard Admin setelah kondisi aman`,
        ``,
        `🕐 ${safeTime}`,
        `🔴 <b>SEGERA TANGANI — RISIKO LUAPAN AIR!</b>`,
      ].join('\n'),
      parse_mode: 'HTML',
    };
  }

  const emoji    = level === 'critical' ? '🚨' : '⚠️';
  const bar      = level === 'critical' ? '🔴🔴🔴' : '🟡🟡🟡';
  const levelStr = escapeMarkdownV2(level.toUpperCase());
  const nodeId   = escapeCode(alertData.node_id || alertData.device_id || 'N/A');
  const param    = escapeMarkdownV2(alertData.parameter || '—');
  const val      = escapeMarkdownV2(alertData.measured_value ?? '—');
  const min      = escapeMarkdownV2(alertData.threshold_min ?? '—');
  const max      = escapeMarkdownV2(alertData.threshold_max ?? '—');
  const msg      = escapeMarkdownV2(alertData.pesan_notifikasi || '—');
  const timeStr  = escapeMarkdownV2(new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }));

  return {
    text: [
      `${bar}`,
      `${emoji} *B\\-Monitor Alert* ${emoji}`,
      ``,
      `*Level:* ${levelStr}`,
      `*Node:* \`${nodeId}\``,
      `*Parameter:* ${param}`,
      `*Nilai:* ${val}`,
      `*Batas:* ${min} \\- ${max}`,
      ``,
      `📝 ${msg}`,
      ``,
      `🕐 ${timeStr}`,
    ].join('\n'),
    parse_mode: 'MarkdownV2',
  };
}

async function sendToChat(chatId, text, parseMode = 'MarkdownV2') {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${API_BASE}/sendMessage`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        chat_id                : chatId,
        text,
        parse_mode             : parseMode,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    const data = await res.json();

    if (!data.ok) {
      if (res.status === 429) {
        const retryAfter = data.parameters?.retry_after || 10;
        throw new RateLimitError(`Rate limited. Retry after ${retryAfter}s`, retryAfter);
      }

      const desc = data.description || '';

      if (data.error_code === 400 && desc.toLowerCase().includes("can't parse entities")) {
        console.warn(`[TelegramQueue] MarkdownV2 parse failed for chat=${chatId} (${desc}) — attempting plain text fallback`);
        try {
          const fallbackRes = await fetch(`${API_BASE}/sendMessage`, {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({
              chat_id                 : chatId,
              text                    : stripMarkdownEscapes(text),
              disable_web_page_preview: true,
            }),
            signal: controller.signal,
          });
          const fallbackData = await fallbackRes.json();
          if (fallbackData.ok) {
            console.log(`[TelegramQueue] ✓ Plain-text fallback sent to chat=${chatId}`);
            return fallbackData;
          }
        } catch (fallbackErr) {
          console.error(`[TelegramQueue] Plain-text fallback failed for chat=${chatId}:`, fallbackErr.message);
        }
        // Throw TelegramParseError (not InvalidChatError) so parse failures still retry.
        throw new TelegramParseError(`Formatting parse error for chat '${chatId}': ${desc}`);
      }

      const isInvalidChat = data.error_code === 403 ||
        (data.error_code === 400 && (
          desc.toLowerCase().includes('chat not found') ||
          desc.toLowerCase().includes('user not found') ||
          desc.toLowerCase().includes('chat_id is empty') ||
          desc.toLowerCase().includes('group chat was deactivated') ||
          desc.toLowerCase().includes('peer_id_invalid') ||
          desc.toLowerCase().includes('bot was kicked') ||
          desc.toLowerCase().includes('deactivated')
        ));

      if (isInvalidChat) {
        throw new InvalidChatError(`Invalid chat_id '${chatId}': ${desc}`);
      }

      throw new Error(`Telegram API error: ${desc}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

class RateLimitError extends Error {
  constructor(msg, retryAfterSec) {
    super(msg);
    this.name         = 'RateLimitError';
    this.retryAfterMs = retryAfterSec * 1000;
  }
}

class InvalidChatError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'InvalidChatError';
  }
}

class TelegramParseError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'TelegramParseError';
  }
}

function isCooldown(deviceId, parameter) {
  if (!parameter || !deviceId) return false;
  const key  = `${deviceId}:${parameter}`;
  const last = cooldownMap.get(key);
  if (!last) return false;
  return (Date.now() - last) < COOLDOWN_MS;
}

function setCooldown(deviceId, parameter) {
  if (!parameter || !deviceId) return;
  cooldownMap.set(`${deviceId}:${parameter}`, Date.now());
}

let _itemCounter = 0;

function enqueue({ priority = PRIORITY.CAUTION, deviceId, alertData, forceSend = false }) {
  if (!BOT_TOKEN) {
    console.warn('[TelegramQueue] Bot token not set — message dropped.');
    return;
  }

  if (priority < PRIORITY.FAILSAFE && !forceSend) {
    if (isCooldown(deviceId, alertData?.parameter)) {
      console.log(`[TelegramQueue] Cooldown active for device=${deviceId} param=${alertData?.parameter} — skipped`);
      return;
    }
    setCooldown(deviceId, alertData?.parameter);
  }

  // Drop oldest CAUTION item when queue reaches MAX_QUEUE_SIZE so WARNING/FAILSAFE stay queued.
  if (queue.length >= MAX_QUEUE_SIZE) {
    const dropIdx = queue.findIndex(i => i.priority === PRIORITY.CAUTION);
    if (dropIdx >= 0) {
      _persistDelete(queue[dropIdx].id);
      queue.splice(dropIdx, 1);
      console.warn('[TelegramQueue] Queue full — dropped oldest CAUTION item');
    } else {
      console.error('[TelegramQueue] Queue full and no CAUTION to drop — message lost!');
      return;
    }
  }

  const item = {
    id           : `tq-${Date.now()}-${++_itemCounter}`,
    priority,
    deviceId,
    alertData    : { ...alertData },
    recipients   : null,
    retryCount   : 0,
    nextAttemptAt: 0,
    createdAt    : Date.now(),
  };

  const insertIdx = queue.findIndex(q => q.priority < priority);
  if (insertIdx === -1) {
    queue.push(item);
  } else {
    queue.splice(insertIdx, 0, item);
  }

  _persistAdd(item);
  console.log(`[TelegramQueue] Enqueued [${_priorityName(priority)}] id=${item.id} device=${deviceId} queue_size=${queue.length}`);
  _startWorker();
}

function _priorityName(p) {
  return Object.entries(PRIORITY).find(([, v]) => v === p)?.[0] || String(p);
}

function _startWorker() {
  if (workerTimer || isProcessing) return;
  workerTimer = setInterval(_processNext, WORKER_INTERVAL_MS);
  workerTimer.unref?.();
}

function _stopWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

async function _processNext() {
  if (isProcessing || queue.length === 0) {
    if (queue.length === 0) _stopWorker();
    return;
  }

  const now  = Date.now();
  const item = queue.find(i => i.nextAttemptAt <= now);
  if (!item) return;

  isProcessing = true;

  try {
    if (!item.recipients) {
      if (item.priority === PRIORITY.FAILSAFE) {
        item.recipients = await resolveEmergencyRecipients(item.deviceId);
      } else {
        item.recipients = await resolveRecipients(item.deviceId);
      }

      if (item.recipients.length === 0) {
        console.warn(`[TelegramQueue] No recipients for device=${item.deviceId} — moved to DLQ`);
        _persistDead(item.id, 'no recipients');
        _removeFromQueue(item.id);
        return;
      }
    }

    const { text, parse_mode } = formatAlertMessage(item.alertData, item.priority);

    let allSuccess = true;
    let sent = 0;
    const invalid = [];
    for (const chatId of item.recipients) {
      try {
        await sendToChat(chatId, text, parse_mode);
        sent++;
        console.log(`[TelegramQueue] ✓ Sent [${_priorityName(item.priority)}] to chat=${chatId} (device=${item.deviceId})`);
      } catch (err) {
        if (err instanceof InvalidChatError) {
          console.error(`[TelegramQueue] Invalid chat_id ${chatId} — skipping permanently:`, err.message);
          invalid.push(chatId);
          continue;
        }
        if (err instanceof RateLimitError) {
          allSuccess        = false;
          item.nextAttemptAt = now + err.retryAfterMs;
          console.warn(`[TelegramQueue] Rate limited for chat=${chatId} — retry after ${err.retryAfterMs}ms`);
          break;
        }
        if (err instanceof TelegramParseError) {
          // Keep allSuccess=false so formatting errors retry instead of being silently dropped.
          allSuccess = false;
          console.error(`[TelegramQueue] Format parse error for chat=${chatId}:`, err.message);
          continue;
        }
        allSuccess = false;
        console.error(`[TelegramQueue] Failed to send to chat=${chatId}:`, err.message);
      }
    }

    // Clear stale route cache so invalid chat_ids are re-resolved on next alert.
    if (invalid.length) invalidateRouteCache(item.deviceId);

    if (allSuccess && sent === 0 && invalid.length) {
      // Every recipient was invalid: move to DLQ instead of treating as delivered.
      console.error(`[TelegramQueue] ✗ DLQ: all recipients invalid for item ${item.id} (${invalid.join(',')})`);
      _persistDead(item.id, 'invalid chat_id: ' + invalid.join(','));
      _removeFromQueue(item.id);
      deadCount++;
    } else if (allSuccess) {
      if (invalid.length) console.error(`[TelegramQueue] item ${item.id} delivered, invalid chat_id skipped: ${invalid.join(',')}`);
      _persistDelete(item.id);
      _removeFromQueue(item.id);
    } else {
      item.retryCount++;
      const maxRetry = MAX_RETRY[item.priority] ?? 5;

      if (item.retryCount > maxRetry) {
        console.error(`[TelegramQueue] ✗ Max retries (${maxRetry}) exceeded for item ${item.id} — moved to DLQ`);
        _persistDead(item.id, `max retries (${maxRetry}) exceeded`);
        _removeFromQueue(item.id);
        return;
      }

      if (item.nextAttemptAt <= now) {
        const backoffIdx = Math.min(item.retryCount - 1, BACKOFF_SCHEDULE.length - 1);
        item.nextAttemptAt = now + BACKOFF_SCHEDULE[backoffIdx];
        console.log(`[TelegramQueue] Retry ${item.retryCount}/${maxRetry} scheduled in ${BACKOFF_SCHEDULE[backoffIdx] / 1000}s for item=${item.id}`);
      }
      _persistRetry(item);
    }
  } catch (err) {
    console.error('[TelegramQueue] Worker error:', err.message);
  } finally {
    isProcessing = false;
  }
}

function _removeFromQueue(id) {
  const idx = queue.findIndex(i => i.id === id);
  if (idx >= 0) queue.splice(idx, 1);
}

function sendAlert(alertData) {
  const level    = (alertData.level_peringatan || 'warning').toLowerCase();
  const priority = level === 'critical' || level === 'failsafe'
    ? PRIORITY.WARNING
    : PRIORITY.CAUTION;

  enqueue({
    priority,
    deviceId : alertData.device_id,
    alertData: { ...alertData },
  });
}

function sendDssAlert({ deviceId, nodeId, dssScore, recommendation, readings, level }) {
  const isBahaya = level === 'bahaya';
  const msg = isBahaya
    ? `🚨 Kondisi BAHAYA pada node ${nodeId}. DSS Score: ${dssScore}/100. Suhu: ${readings.suhu}°C, Salinitas: ${readings.salinitas} ppt. Sistem mengaktifkan protokol darurat otomatis.`
    : `⚠️ Status WASPADA pada node ${nodeId}. DSS Score: ${dssScore}/100. Suhu: ${readings.suhu}°C, Salinitas: ${readings.salinitas} ppt. Pantau kondisi tambak.`;

  enqueue({
    priority : isBahaya ? PRIORITY.WARNING : PRIORITY.CAUTION,
    deviceId,
    alertData: {
      device_id       : deviceId,
      node_id         : nodeId,
      parameter       : 'dss_score',
      measured_value  : dssScore,
      threshold_min   : 0,
      threshold_max   : isBahaya ? 65 : 35,
      level_peringatan: isBahaya ? 'critical' : 'warning',
      pesan_notifikasi: msg,
    },
    forceSend: isBahaya,
  });
}

function sendEmergency({ deviceId, nodeId, message }) {
  enqueue({
    priority : PRIORITY.FAILSAFE,
    deviceId,
    alertData: {
      device_id       : deviceId,
      node_id         : nodeId,
      pesan_notifikasi: message,
      level_peringatan: 'failsafe',
    },
    forceSend: true,
  });
}

function getQueueStatus() {
  const now = Date.now();
  return {
    total         : queue.length,
    by_priority   : {
      failsafe: queue.filter(i => i.priority === PRIORITY.FAILSAFE).length,
      warning : queue.filter(i => i.priority === PRIORITY.WARNING).length,
      caution : queue.filter(i => i.priority === PRIORITY.CAUTION).length,
    },
    pending_retry : queue.filter(i => i.nextAttemptAt > now).length,
    worker_active : workerTimer !== null,
    dead_since_start: deadCount,
  };
}

// Persisted items are restored by loadPersisted() from server.js once MySQL is ready.
if (!isInitialized) {
  isInitialized = true;
  console.log('[TelegramQueue] Initialized. Bot:', BOT_TOKEN ? 'configured' : 'NOT configured');
}

module.exports = {
  enqueue,
  sendAlert,
  sendDssAlert,
  sendEmergency,
  getQueueStatus,
  sendToChat,
  loadPersisted,
  invalidateRouteCache,
  PRIORITY,
  escapeMarkdownV2,
  escapeCode,
  escapeHtml,
  stripMarkdownEscapes,
  RateLimitError,
  InvalidChatError,
  TelegramParseError,
  formatAlertMessage,
};
