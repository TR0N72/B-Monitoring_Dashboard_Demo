'use strict';

const tq = require('./telegramQueue');

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || '';
const FALLBACK_ID = process.env.TELEGRAM_CHAT_ID   || '';
const API_BASE    = `https://api.telegram.org/bot${BOT_TOKEN}`;

function sendTelegramAlert(alertData) {
  tq.sendAlert(alertData);
  return Promise.resolve(null);
}

// Direct fire-and-forget send to FALLBACK_ID without retry queue.
async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !FALLBACK_ID) {
    console.warn('[Telegram] sendTelegramMessage skipped — bot or fallback chat_id not configured');
    return null;
  }

  try {
    const res    = await fetch(`${API_BASE}/sendMessage`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        chat_id   : FALLBACK_ID,
        text,
        parse_mode: 'Markdown',
      }),
    });
    return await res.json();
  } catch (err) {
    console.error('[Telegram] sendTelegramMessage error:', err.message);
    return null;
  }
}

function sendEmergencyAlert({ node_id, message, deviceId = null }) {
  tq.sendEmergency({ deviceId, nodeId: node_id, message });
  return Promise.resolve(null);
}

async function verifyBot() {
  if (!BOT_TOKEN) {
    console.warn('[Telegram] No bot token configured');
    return false;
  }

  try {
    const res    = await fetch(`${API_BASE}/getMe`);
    const result = await res.json();
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
  sendEmergencyAlert,
  verifyBot,
  getQueueStatus    : tq.getQueueStatus,
  invalidateRouteCache: tq.invalidateRouteCache,
  PRIORITY          : tq.PRIORITY,
};
