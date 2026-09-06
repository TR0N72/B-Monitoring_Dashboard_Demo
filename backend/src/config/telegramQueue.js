'use strict';
/**
 * telegramQueue.js — Telegram Notification Queue dengan Dynamic Routing & Retry
 * ==============================================================================
 * Modul ini menjadi pusat pengiriman semua notifikasi Telegram dalam sistem
 * B-Monitor. Menggantikan pengiriman langsung ke TELEGRAM_CHAT_ID global
 * dengan sistem yang:
 *
 *  1. DYNAMIC ROUTING
 *     Setiap alert dirutekan ke pengguna (pekerja/admin) yang relevan
 *     berdasarkan field `kontak_telegram` di tabel `users`.
 *     Prioritas routing (urutan):
 *       a. Pekerja yang terdaftar pada device (devices.user_id → users.kontak_telegram)
 *       b. Semua admin (role='admin' dengan kontak_telegram terisi)
 *       c. Fallback: TELEGRAM_CHAT_ID global dari environment variable
 *
 *  2. PRIORITY QUEUE
 *     Tiga level prioritas pesan:
 *       FAILSAFE  (3) — Darurat mesin gagal mati, dikirim segera, tidak pernah di-drop
 *       WARNING   (2) — Kondisi kritis/bahaya, dikirim segera
 *       CAUTION   (1) — Peringatan awal, bisa terlambat saat antrian penuh
 *
 *  3. PERSISTENT RETRY
 *     Jika pengiriman gagal (timeout, network down, rate limit):
 *       - Pesan kembali ke antrian dengan incremental backoff
 *       - Max retry: FAILSAFE=unlimited, WARNING=10, CAUTION=5
 *       - Backoff: 10s → 30s → 60s → 120s → 300s (cap)
 *       - Antrian max: MAX_QUEUE_SIZE item (oldest CAUTION di-drop jika penuh)
 *
 *  4. RATE LIMIT PROTECTION
 *     Telegram membatasi 30 pesan/detik per bot global dan 1 pesan/detik
 *     per chat_id. Worker memproses dengan delay minimum 1.1 detik per chat.
 *
 *  5. COOLDOWN PER ALERT TYPE
 *     Pesan jenis CAUTION/WARNING memiliki cooldown per (device, parameter)
 *     untuk mencegah spam. FAILSAFE tidak memiliki cooldown.
 *
 * Penggunaan:
 *   const tq = require('./telegramQueue');
 *   tq.enqueue({ priority: tq.PRIORITY.WARNING, deviceId: 1, alertData: {...} });
 */

const { getPool } = require('./db');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN || '';
const FALLBACK_ID  = process.env.TELEGRAM_CHAT_ID   || '';
const API_BASE     = `https://api.telegram.org/bot${BOT_TOKEN}`;

const MAX_QUEUE_SIZE     = 500;
const WORKER_INTERVAL_MS = 1100;   // ~1 pesan/detik per chat (aman untuk rate limit)
const COOLDOWN_MS        = parseInt(process.env.ALERT_COOLDOWN_MS || '300000', 10); // 5 menit

/** Backoff delays (ms) untuk retry — index = attempt ke-n (0-based) */
const BACKOFF_SCHEDULE = [10_000, 30_000, 60_000, 120_000, 300_000];

/** Prioritas antrian */
const PRIORITY = Object.freeze({ CAUTION: 1, WARNING: 2, FAILSAFE: 3 });

/** Batas max retry per prioritas */
const MAX_RETRY = { [PRIORITY.CAUTION]: 5, [PRIORITY.WARNING]: 10, [PRIORITY.FAILSAFE]: Infinity };

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Queue & State
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Array<QueueItem>} */
const queue         = [];
let workerTimer     = null;
let isProcessing    = false;
let isInitialized   = false;

/** Cooldown map: key = `device_id:parameter` → timestamp */
const cooldownMap   = new Map();

/** Cache resolusi routing: deviceId → [chatId, ...] TTL 5 menit */
const routeCache    = new Map();
const ROUTE_TTL_MS  = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Routing: Resolve chat IDs dari database
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve daftar Telegram chat_id yang harus menerima alert untuk device tertentu.
 *
 * Logika:
 *  1. Pekerja yang ditugaskan ke device (devices.user_id → users.kontak_telegram)
 *  2. Semua admin dengan kontak_telegram terisi
 *  3. Fallback: TELEGRAM_CHAT_ID global
 *
 * @param {number|null} deviceId - Internal DB device ID (null = broadcast ke admin saja)
 * @returns {Promise<string[]>} Array chat_id unik yang valid
 */
async function resolveRecipients(deviceId) {
  // Cek cache
  const cacheKey = `device:${deviceId}`;
  const cached   = routeCache.get(cacheKey);
  if (cached && (Date.now() - cached.at) < ROUTE_TTL_MS) {
    return cached.ids;
  }

  const chatIds = new Set();

  try {
    const pool = getPool();

    // ── 1. Pekerja yang ditugaskan ke device ini ─────────────────────────
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

    // ── 2. Semua admin dengan Telegram terdaftar ──────────────────────────
    const [admins] = await pool.execute(
      `SELECT kontak_telegram FROM users
       WHERE role = 'admin' AND kontak_telegram IS NOT NULL AND kontak_telegram != ''`
    );
    admins.forEach(a => chatIds.add(a.kontak_telegram.trim()));

  } catch (dbErr) {
    console.warn('[TelegramQueue] DB route resolution failed, using fallback:', dbErr.message);
  }

  // ── 3. Fallback ke global TELEGRAM_CHAT_ID ────────────────────────────
  if (chatIds.size === 0 && FALLBACK_ID) {
    chatIds.add(FALLBACK_ID);
  }

  const ids = [...chatIds].filter(Boolean);
  routeCache.set(cacheKey, { ids, at: Date.now() });
  return ids;
}

/**
 * Resolve penerima untuk FAILSAFE — selalu semua admin + fallback, tidak pakai cache.
 * @returns {Promise<string[]>}
 */
async function resolveEmergencyRecipients(deviceId) {
  const chatIds = new Set();
  try {
    const pool = getPool();

    // Semua user dengan kontak_telegram (admin dan pekerja terdaftar)
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

// Invalidasi cache routing saat user diperbarui
function invalidateRouteCache(deviceId = null) {
  if (deviceId) {
    routeCache.delete(`device:${deviceId}`);
  } else {
    routeCache.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Formatting
// ─────────────────────────────────────────────────────────────────────────────

/** Buat teks pesan Telegram dari alertData. */
function formatAlertMessage(alertData, priority) {
  const level = (alertData.level_peringatan || 'warning').toLowerCase();

  if (priority === PRIORITY.FAILSAFE) {
    return {
      text: [
        `🆘🆘🆘 <b>EMERGENCY FAILSAFE ALERT</b> 🆘🆘🆘`,
        ``,
        `⛽ <b>Node:</b> <code>${alertData.node_id || alertData.device_id}</code>`,
        ``,
        `${alertData.pesan_notifikasi}`,
        ``,
        `⚠️ <b>Tindakan yang diperlukan:</b>`,
        `1. Periksa mesin diesel secara langsung`,
        `2. Pastikan katup kuras terbuka`,
        `3. Laporkan ke koordinator lapangan`,
        `4. Reset via Dashboard Admin setelah kondisi aman`,
        ``,
        `🕐 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
        `🔴 <b>SEGERA TANGANI — RISIKO LUAPAN AIR!</b>`,
      ].join('\n'),
      parse_mode: 'HTML',
    };
  }

  const emoji    = level === 'critical' ? '🚨' : '⚠️';
  const bar      = level === 'critical' ? '🔴🔴🔴' : '🟡🟡🟡';
  const levelStr = level.toUpperCase();

  return {
    text: [
      `${bar}`,
      `${emoji} *B\\-Monitor Alert* ${emoji}`,
      ``,
      `*Level:* ${levelStr}`,
      `*Node:* \`${alertData.node_id || alertData.device_id || 'N/A'}\``,
      `*Parameter:* ${alertData.parameter || '—'}`,
      `*Nilai:* ${alertData.measured_value ?? '—'}`,
      `*Batas:* ${alertData.threshold_min ?? '—'} — ${alertData.threshold_max ?? '—'}`,
      ``,
      `📝 ${alertData.pesan_notifikasi}`,
      ``,
      `🕐 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
    ].join('\n'),
    parse_mode: 'MarkdownV2',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram HTTP Sender
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kirim satu pesan ke satu chat_id. Lempar error jika gagal.
 * @param {string} chatId
 * @param {string} text
 * @param {string} parseMode
 */
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
      // Rate limit — Telegram mengembalikan 429
      if (res.status === 429) {
        const retryAfter = data.parameters?.retry_after || 10;
        throw new RateLimitError(`Rate limited. Retry after ${retryAfter}s`, retryAfter);
      }
      // Chat tidak ditemukan / tidak valid
      if (data.error_code === 400 || data.error_code === 403) {
        throw new InvalidChatError(`Invalid chat_id '${chatId}': ${data.description}`);
      }
      throw new Error(`Telegram API error: ${data.description}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

class RateLimitError extends Error {
  constructor(msg, retryAfterSec) {
    super(msg);
    this.name           = 'RateLimitError';
    this.retryAfterMs   = retryAfterSec * 1000;
  }
}

class InvalidChatError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'InvalidChatError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cooldown Check
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Queue Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} QueueItem
 * @property {number}   priority        - PRIORITY.CAUTION | WARNING | FAILSAFE
 * @property {number}   deviceId        - Internal DB device ID
 * @property {object}   alertData       - Data alert (parameter, measured_value, dll)
 * @property {string[]} [recipients]    - Jika sudah resolve, simpan di sini
 * @property {number}   retryCount      - Jumlah percobaan gagal
 * @property {number}   nextAttemptAt   - Timestamp minimum sebelum retry
 * @property {number}   createdAt       - Timestamp pertama kali dimasukkan
 * @property {string}   id              - UUID item untuk tracking
 */

let _itemCounter = 0;

/**
 * Masukkan pesan ke antrian notifikasi.
 *
 * @param {object} opts
 * @param {number}  opts.priority    - Gunakan PRIORITY.CAUTION/WARNING/FAILSAFE
 * @param {number}  opts.deviceId    - Device ID sumber alert
 * @param {object}  opts.alertData   - Objek data alert
 * @param {boolean} [opts.forceSend] - Abaikan cooldown (untuk FAILSAFE)
 */
function enqueue({ priority = PRIORITY.CAUTION, deviceId, alertData, forceSend = false }) {
  if (!BOT_TOKEN) {
    console.warn('[TelegramQueue] Bot token not set — message dropped.');
    return;
  }

  // Cek cooldown (kecuali FAILSAFE atau forceSend)
  if (priority < PRIORITY.FAILSAFE && !forceSend) {
    if (isCooldown(deviceId, alertData?.parameter)) {
      console.log(`[TelegramQueue] Cooldown active for device=${deviceId} param=${alertData?.parameter} — skipped`);
      return;
    }
    setCooldown(deviceId, alertData?.parameter);
  }

  // Tangani antrian penuh: drop item CAUTION terlama
  if (queue.length >= MAX_QUEUE_SIZE) {
    const dropIdx = queue.findIndex(i => i.priority === PRIORITY.CAUTION);
    if (dropIdx >= 0) {
      queue.splice(dropIdx, 1);
      console.warn('[TelegramQueue] Queue full — dropped oldest CAUTION item');
    } else {
      console.error('[TelegramQueue] Queue full and no CAUTION to drop — message lost!');
      return;
    }
  }

  /** @type {QueueItem} */
  const item = {
    id           : `tq-${Date.now()}-${++_itemCounter}`,
    priority,
    deviceId,
    alertData    : { ...alertData },
    recipients   : null,  // Akan di-resolve saat processing
    retryCount   : 0,
    nextAttemptAt: 0,
    createdAt    : Date.now(),
  };

  // Insert dengan urutan prioritas (FAILSAFE dulu, dst)
  const insertIdx = queue.findIndex(q => q.priority < priority);
  if (insertIdx === -1) {
    queue.push(item);
  } else {
    queue.splice(insertIdx, 0, item);
  }

  console.log(`[TelegramQueue] Enqueued [${_priorityName(priority)}] id=${item.id} device=${deviceId} queue_size=${queue.length}`);
  _startWorker();
}

function _priorityName(p) {
  return Object.entries(PRIORITY).find(([, v]) => v === p)?.[0] || String(p);
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Worker
// ─────────────────────────────────────────────────────────────────────────────

function _startWorker() {
  if (workerTimer || isProcessing) return;
  workerTimer = setInterval(_processNext, WORKER_INTERVAL_MS);
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
  if (!item) return;  // Semua item masih dalam backoff

  isProcessing = true;

  try {
    // ── Resolve recipients jika belum ada ──────────────────────────────
    if (!item.recipients) {
      if (item.priority === PRIORITY.FAILSAFE) {
        item.recipients = await resolveEmergencyRecipients(item.deviceId);
      } else {
        item.recipients = await resolveRecipients(item.deviceId);
      }

      if (item.recipients.length === 0) {
        console.warn(`[TelegramQueue] No recipients for device=${item.deviceId} — item dropped`);
        _removeFromQueue(item.id);
        return;
      }
    }

    const { text, parse_mode } = formatAlertMessage(item.alertData, item.priority);

    // ── Kirim ke semua penerima ────────────────────────────────────────
    let allSuccess = true;
    for (const chatId of item.recipients) {
      try {
        await sendToChat(chatId, text, parse_mode);
        console.log(`[TelegramQueue] ✓ Sent [${_priorityName(item.priority)}] to chat=${chatId} (device=${item.deviceId})`);
      } catch (err) {
        if (err instanceof InvalidChatError) {
          // Chat ID tidak valid — log dan skip, jangan retry untuk ID ini
          console.error(`[TelegramQueue] Invalid chat_id ${chatId} — skipping permanently:`, err.message);
          continue;
        }
        if (err instanceof RateLimitError) {
          // Rate limited — requeue dengan delay khusus
          allSuccess        = false;
          item.nextAttemptAt = now + err.retryAfterMs;
          console.warn(`[TelegramQueue] Rate limited for chat=${chatId} — retry after ${err.retryAfterMs}ms`);
          break;
        }
        // Network error / timeout — requeue dengan backoff
        allSuccess = false;
        console.error(`[TelegramQueue] Failed to send to chat=${chatId}:`, err.message);
      }
    }

    if (allSuccess) {
      _removeFromQueue(item.id);
    } else {
      // Hitung retry
      item.retryCount++;
      const maxRetry = MAX_RETRY[item.priority] ?? 5;

      if (item.retryCount > maxRetry) {
        console.error(`[TelegramQueue] ✗ Max retries (${maxRetry}) exceeded for item ${item.id} — dropped`);
        _removeFromQueue(item.id);
        return;
      }

      // Backoff schedule
      if (item.nextAttemptAt <= now) {
        const backoffIdx = Math.min(item.retryCount - 1, BACKOFF_SCHEDULE.length - 1);
        item.nextAttemptAt = now + BACKOFF_SCHEDULE[backoffIdx];
        console.log(`[TelegramQueue] Retry ${item.retryCount}/${maxRetry} scheduled in ${BACKOFF_SCHEDULE[backoffIdx] / 1000}s for item=${item.id}`);
      }
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

// ─────────────────────────────────────────────────────────────────────────────
// Public API — Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kirim alert sensor threshold (Caution/Warning).
 * Equivalent dari sendTelegramAlert() lama, dengan routing dinamis.
 *
 * @param {object} alertData - { device_id, node_id, parameter, measured_value,
 *                               threshold_min, threshold_max,
 *                               level_peringatan, pesan_notifikasi }
 */
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

/**
 * Kirim notifikasi DSS Waspada/Bahaya dari aktuator controller.
 *
 * @param {object} opts
 * @param {number} opts.deviceId
 * @param {string} opts.nodeId
 * @param {number} opts.dssScore
 * @param {string} opts.recommendation
 * @param {object} opts.readings - { suhu, salinitas }
 * @param {'waspada'|'bahaya'} opts.level
 */
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
    forceSend: isBahaya, // Kondisi bahaya selalu dikirim meski cooldown
  });
}

/**
 * Kirim emergency alert (Failsafe SW-420) ke SEMUA penerima terdaftar.
 * Tidak ada cooldown, selalu retry sampai berhasil.
 *
 * @param {object} opts
 * @param {number} opts.deviceId
 * @param {string} opts.nodeId
 * @param {string} opts.message
 */
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

/**
 * Status antrian saat ini — untuk endpoint health check.
 * @returns {object}
 */
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
  };
}

// Inisialisasi worker saat module dimuat (jika antrian ada dari restart — tidak persist,
// tapi mekanisme ini siap untuk implementasi persistent queue ke DB di masa depan)
if (!isInitialized) {
  isInitialized = true;
  // Worker akan di-start otomatis saat ada item pertama
  console.log('[TelegramQueue] Initialized. Bot:', BOT_TOKEN ? 'configured' : 'NOT configured');
}

module.exports = {
  enqueue,
  sendAlert,
  sendDssAlert,
  sendEmergency,
  getQueueStatus,
  invalidateRouteCache,
  PRIORITY,
};
