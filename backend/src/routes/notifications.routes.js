const express = require('express');
const router = express.Router();
const { getPool } = require('../config/db');
const { sendTelegramAlert, sendTelegramMessage, verifyBot } = require('../config/telegram');
const { broadcastAlert } = require('../socket/alerts');

router.post('/trigger', async (req, res) => {
  try {
    const { device_id, parameter, measured_value, threshold_min, threshold_max, level_peringatan, pesan_notifikasi } = req.body;

    if (!device_id || !parameter || measured_value === undefined) {
      return res.status(400).json({ error: 'Missing required fields: device_id, parameter, measured_value' });
    }

    const pool = getPool();

    const [devices] = await pool.execute('SELECT id, name FROM devices WHERE device_id = ?', [device_id]);
    if (devices.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const internalId = devices[0].id;
    const deviceName = devices[0].name;

    const level = level_peringatan || 'warning';
    const message = pesan_notifikasi || `Parameter ${parameter} out of range: ${measured_value}`;

    const [result] = await pool.execute(
      `INSERT INTO alert_logs (device_id, parameter, measured_value, threshold_min, threshold_max, level_peringatan, pesan_notifikasi)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [internalId, parameter, measured_value, threshold_min || 0, threshold_max || 0, level, message]
    );

    const alertPayload = {
      id: result.insertId,
      device_id,
      device_name: deviceName,
      parameter,
      measured_value,
      threshold_min,
      threshold_max,
      level_peringatan: level,
      pesan_notifikasi: message,
    };

    broadcastAlert(alertPayload);

    const telegramResult = await sendTelegramAlert(alertPayload);

    res.status(201).json({
      message: 'Alert created and dispatched',
      alert_id: result.insertId,
      websocket_broadcast: true,
      telegram_sent: telegramResult !== null,
    });
  } catch (err) {
    console.error('[Alerts] Trigger error:', err.message);
    res.status(500).json({ error: 'Failed to trigger alert' });
  }
});

router.post('/test-telegram', async (req, res) => {
  try {
    const verified = await verifyBot();
    if (!verified) {
      return res.status(503).json({ error: 'Telegram bot not configured or unreachable' });
    }

    const result = await sendTelegramMessage(
      '✅ *B-Monitor Test*\n\nTelegram notifications are working correctly.\n\n🕐 ' +
      new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
    );

    if (result && result.ok) {
      return res.json({ message: 'Test message sent successfully', message_id: result.result.message_id });
    }

    res.status(500).json({ error: 'Failed to send test message', details: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram-status', async (req, res) => {
  try {
    const verified = await verifyBot();
    res.json({
      configured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      bot_reachable: verified,
    });
  } catch (err) {
    res.json({ configured: false, bot_reachable: false, error: err.message });
  }
});

module.exports = router;