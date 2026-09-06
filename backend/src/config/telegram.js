'use strict';
/**
 * telegram.js — Telegram Notification Gateway (Thin Wrapper)
 * ===========================================================
 * Modul ini adalah gateway utama untuk notifikasi Telegram.
 * Semua pengiriman pesan didelegasikan ke telegramQueue.js yang menangani:
 *   - Dynamic routing ke kontak_telegram pekerja di DB
 *   - Priority queue (FAILSAFE > WARNING > CAUTION)
 *   - Persistent retry dengan exponential backoff
 *   - Rate limit protection & cooldown anti-spam
 *
 * API backward-compatible dengan modul lama:
 *   sendTelegramAlert(alertData)        → sendAlert() via queue
 *   sendTelegramMessage(text)           → direct send (one-shot, no retry)
 *   sendEmergencyAlert({ node_id, ... }) → sendEmergency() via queue (max priority)
 *   verifyBot()                          → cek koneksi bot
 */

const tq = require('./telegramQueue');

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || '';
const FALLBACK_ID = process.env.TELEGRAM_CHAT_ID   || '';
const API_BASE    = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kirim alert sensor ke pekerja/admin yang relevan dengan device.
 * Menggunakan dynamic routing dari DB + retry queue.
 *
 * @param {object} alertData
 * @param {number}  alertData.device_id
 * @param {string}  [alertData.node_id]       - Ditampilkan di pesan
 * @param {string}  alertData.parameter        - Nama parameter sensor
 * @param {number}  alertData.measured_value
 * @param {number}  alertData.threshold_min
 * @param {number}  alertData.threshold_max
 * @param {string}  alertData.level_peringatan - 'warning' | 'critical'
 * @param {string}  alertData.pesan_notifikasi
 */
function sendTelegramAlert(alertData) {
  tq.sendAlert(alertData);
  return Promise.resolve(null); // Backward-compatible: caller await-safe
}

/**
 * Kirim pesan teks bebas ke FALLBACK_ID (satu-satunya chat_id global).
 * Digunakan untuk pesan debug/sistem, bukan alert sensor.
 * Tidak menggunakan retry queue — fire-and-forget.
 *
 * @param {string} text
 * @returns {Promise<object|null>}
 */
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

/**
 * Kirim notifikasi DARURAT Failsafe SW-420.
 * Menggunakan priority FAILSAFE (tertinggi), tidak ada cooldown, retry unlimited.
 * Dikirim ke SEMUA admin dan pekerja yang terdaftar.
 *
 * @param {object} opts
 * @param {string} opts.node_id  - Hardware node ID
 * @param {string} opts.message  - Pesan darurat
 * @param {number} [opts.deviceId] - Internal device ID (untuk routing)
 */
function sendEmergencyAlert({ node_id, message, deviceId = null }) {
  tq.sendEmergency({ deviceId, nodeId: node_id, message });
  return Promise.resolve(null); // Backward-compatible
}

/**
 * Verifikasi koneksi bot Telegram ke API.
 * @returns {Promise<boolean>}
 */
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
  // Re-export queue utilities untuk route-level access
  getQueueStatus    : tq.getQueueStatus,
  invalidateRouteCache: tq.invalidateRouteCache,
  PRIORITY          : tq.PRIORITY,
};