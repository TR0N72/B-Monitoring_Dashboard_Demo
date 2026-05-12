const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

async function sendTelegramAlert(alertData) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] Bot token or chat ID not configured, skipping notification');
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
};