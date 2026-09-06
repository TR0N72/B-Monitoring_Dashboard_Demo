const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const alertCooldowns = new Map();

function isAlertThrottled(alertData) {
  const key = `${alertData.device_id}:${alertData.parameter}`;
  const now = Date.now();
  const lastSent = alertCooldowns.get(key);

  if (lastSent && (now - lastSent) < ALERT_COOLDOWN_MS) {
    return true;
  }

  alertCooldowns.set(key, now);
  return false;
}

async function sendTelegramAlert(alertData) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] Bot token or chat ID not configured, skipping notification');
    return null;
  }

  if (isAlertThrottled(alertData)) {
    console.log(`[Telegram] Alert throttled (cooldown): ${alertData.parameter} on device ${alertData.device_id}`);
    return null;
  }

  const emoji = alertData.level_peringatan === 'critical' ? '🚨' : '⚠️';
  const statusBar = alertData.level_peringatan === 'critical' ? '🔴🔴🔴' : '🟡🟡🟡';

  const message = [
    `${statusBar}`,
    `${emoji} *B-Monitor Alert* ${emoji}`,
    ``,
    `*Level:* ${alertData.level_peringatan.toUpperCase()}`,
    `*Device:* \`${alertData.device_id || 'N/A'}\``,
    `*Parameter:* ${alertData.parameter}`,
    `*Value:* ${alertData.measured_value}`,
    `*Range:* ${alertData.threshold_min} — ${alertData.threshold_max}`,
    ``,
    `📝 ${alertData.pesan_notifikasi}`,
    ``,
    `🕐 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
  ].join('\n');

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      console.error('[Telegram] API error:', result.description);
      return null;
    }

    console.log(`[Telegram] Alert sent: ${alertData.level_peringatan} — ${alertData.parameter}`);
    return result;
  } catch (err) {
    console.error('[Telegram] Failed to send:', err.message);
    return null;
  }
}

async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return null;

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
      }),
    });
    return await response.json();
  } catch (err) {
    console.error('[Telegram] Failed to send message:', err.message);
    return null;
  }
}

async function verifyBot() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[Telegram] No bot token configured');
    return false;
  }

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/getMe`);
    const result = await response.json();
    if (result.ok) {
      console.log(`✓ Telegram Bot connected: @${result.result.username}`);
      return true;
    }
    console.error('[Telegram] Bot verification failed:', result.description);
    return false;
  } catch (err) {
    console.error('[Telegram] Bot verification error:', err.message);
    return false;
  }
}


module.exports = {
  sendTelegramAlert,
  sendTelegramMessage,
  verifyBot,
  sendEmergencyAlert,
};

/**
 * sendEmergencyAlert — Notifikasi Darurat Failsafe (Prioritas Maksimum)
 * ======================================================================
 * Tidak menggunakan throttle/cooldown.
 * Mencoba mengirim hingga 3 kali jika gagal (retry for critical messages).
 *
 * @param {object} opts
 * @param {string} opts.node_id - Hardware node ID
 * @param {string} opts.message - Pesan darurat
 * @param {number} [opts.retries=3] - Jumlah percobaan ulang
 */
async function sendEmergencyAlert({ node_id, message, retries = 3 }) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] Emergency alert skipped — bot not configured');
    return null;
  }

  const text = [
    `🆘🆘🆘 <b>EMERGENCY FAILSAFE ALERT</b> 🆘🆘🆘`,
    ``,
    `⛽ <b>Node:</b> <code>${node_id}</code>`,
    ``,
    `${message}`,
    ``,
    `⚠️ <b>Tindakan yang diperlukan:</b>`,
    `1. Periksa mesin diesel secara langsung`,
    `2. Pastikan katup kuras terbuka`,
    `3. Laporkan ke koordinator lapangan`,
    `4. Reset via Dashboard Admin setelah kondisi aman`,
    ``,
    `🕐 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
    `🔴 <b>SEGERA TANGANI — RISIKO LUAPAN AIR!</b>`,
  ].join('\n');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          chat_id                : TELEGRAM_CHAT_ID,
          text,
          parse_mode             : 'HTML',
          disable_web_page_preview: true,
        }),
      });

      const result = await response.json();
      if (result.ok) {
        console.log(`[Telegram] ✓ Emergency alert sent (attempt ${attempt}/${retries})`);
        return result;
      }
      console.warn(`[Telegram] Emergency attempt ${attempt} failed: ${result.description}`);
    } catch (err) {
      console.error(`[Telegram] Emergency attempt ${attempt} error: ${err.message}`);
    }

    // Backoff sebelum retry (1s, 2s, 4s)
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    }
  }

  console.error(`[Telegram] ✗ Failed to send emergency alert after ${retries} attempts`);
  return null;
}