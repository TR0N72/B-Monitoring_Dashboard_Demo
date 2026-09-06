'use strict';
/**
 * actuator.routes.js — API Routes untuk Kontrol Aktuator & Emergency Management
 * ==============================================================================
 * Endpoints:
 *   POST /api/actuator/command              — Kirim perintah aktuator manual (Admin only)
 *   GET  /api/actuator/logs                 — Riwayat semua log aktuator dengan filter
 *   GET  /api/actuator/emergency/status     — Status emergency state semua device
 *   POST /api/actuator/emergency/reset/:id  — Reset emergency state device (Admin only)
 *   GET  /api/actuator/status/:device_id    — Status aktuator dan engine terkini per device
 */

const express    = require('express');
const { getPool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { publishMQTT }             = require('../config/mqtt');
const { ACTUATOR_ACTIONS }        = require('../services/actuatorController');
const {
  getAllEmergencyStates,
  resetEmergencyState,
  getDeviceState,
}                                 = require('../services/emergencyState');

const router = express.Router();
router.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/actuator/command
// Kirim perintah aktuator secara manual — hanya Admin.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/command', authorize('admin'), async (req, res) => {
  try {
    const { device_id, aksi } = req.body;

    if (!device_id || !aksi) {
      return res.status(400).json({ error: 'device_id and aksi are required' });
    }

    // Validasi nama aksi
    const validActions = Object.values(ACTUATOR_ACTIONS);
    if (!validActions.includes(aksi)) {
      return res.status(400).json({
        error          : `Invalid aksi. Valid values: ${validActions.join(', ')}`,
        valid_actions  : validActions,
      });
    }

    const pool = getPool();
    let q      = 'SELECT id, node_id FROM devices WHERE node_id = ?';
    let params = [String(device_id)];
    if (!isNaN(device_id)) {
      q      += ' OR id = ?';
      params.push(Number(device_id));
    }
    const [devices] = await pool.execute(q, params);
    if (devices.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const { id: internalId, node_id: nodeId } = devices[0];

    const triggerDetail = `Manual command by user_id=${req.user?.id || 'unknown'} (${req.user?.username || '-'})`;

    const [result] = await pool.execute(
      'INSERT INTO actuator_logs (device_id, aksi, trigger_source, trigger_detail, status) VALUES (?, ?, ?, ?, ?)',
      [internalId, aksi, 'manual', triggerDetail, 'pending']
    );

    publishMQTT(`tambak/${nodeId}/actuator/command`, { aksi, command_id: result.insertId }, { qos: 1 });

    return res.status(202).json({
      message   : 'Command sent successfully',
      command_id: result.insertId,
      aksi,
      node_id   : nodeId,
    });
  } catch (err) {
    console.error('[ACTUATOR] Command error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/actuator/logs
// Riwayat semua log aktuator dengan filter device, tanggal, dan paginasi.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/logs', async (req, res) => {
  try {
    const { device_id, start_date, end_date, trigger_source, page = 1, limit = 50 } = req.query;
    const offset    = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(100, parseInt(limit, 10));
    const pageLimit = Math.min(100, parseInt(limit, 10));

    let query = `
      SELECT
        a.id, a.device_id, a.aksi, a.trigger_source, a.trigger_detail,
        a.status, a.executed_at,
        d.node_id, d.name AS device_name
      FROM actuator_logs a
      JOIN devices d ON a.device_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (device_id) {
      if (!isNaN(device_id)) {
        query += ` AND (d.node_id = ? OR d.id = ?)`;
        params.push(String(device_id), Number(device_id));
      } else {
        query += ` AND d.node_id = ?`;
        params.push(device_id);
      }
    }
    if (trigger_source) {
      query += ` AND a.trigger_source = ?`;
      params.push(trigger_source);
    }
    if (start_date) {
      query += ` AND a.executed_at >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND a.executed_at <= ?`;
      params.push(end_date);
    }

    query += ` ORDER BY a.executed_at DESC LIMIT ? OFFSET ?`;
    params.push(String(pageLimit), String(offset));

    const pool   = getPool();
    const [rows] = await pool.execute(query, params);

    return res.json({ data: rows, pagination: { page: parseInt(page, 10), limit: pageLimit } });
  } catch (err) {
    console.error('[ACTUATOR] Logs error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/actuator/emergency/status
// Ambil status Emergency State semua device yang sedang aktif.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/emergency/status', async (req, res) => {
  try {
    const states = getAllEmergencyStates();

    // Enrich dengan nama device dari DB
    if (states.length > 0) {
      const pool = getPool();
      const ids  = states.map(s => s.device_id);
      const [rows] = await pool.execute(
        `SELECT id, node_id, name FROM devices WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      const deviceMap = Object.fromEntries(rows.map(r => [r.id, r]));

      const enriched = states.map(s => ({
        ...s,
        node_id    : deviceMap[s.device_id]?.node_id || null,
        device_name: deviceMap[s.device_id]?.name    || null,
      }));
      return res.json({ data: enriched, count: enriched.length });
    }

    return res.json({ data: states, count: 0 });
  } catch (err) {
    console.error('[ACTUATOR] Emergency status error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/actuator/emergency/reset/:device_id
// Reset emergency state setelah admin mengkonfirmasi kondisi aman.
// Hanya Admin.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/emergency/reset/:device_id', authorize('admin'), async (req, res) => {
  try {
    const deviceId = parseInt(req.params.device_id, 10);
    if (isNaN(deviceId)) {
      return res.status(400).json({ error: 'device_id must be a valid integer' });
    }

    // Verifikasi device ada
    const pool = getPool();
    const [[device]] = await pool.execute(
      'SELECT id, node_id, name FROM devices WHERE id = ?',
      [deviceId]
    );
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Catat reset ke alert_logs
    await pool.execute(
      `INSERT INTO alert_logs
         (device_id, parameter, measured_value, threshold_min, threshold_max, level_peringatan, pesan_notifikasi, acknowledged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        deviceId,
        'emergency_reset',
        0, 0, 0,
        'info',
        `Emergency state di-reset oleh admin (user_id=${req.user?.id || 'unknown'}) pada ${new Date().toLocaleString('id-ID')}`,
        true,
      ]
    );

    // Reset state
    resetEmergencyState(deviceId);

    return res.json({
      message    : `Emergency state for device ${device.node_id} has been reset`,
      device_id  : deviceId,
      node_id    : device.node_id,
      reset_by   : req.user?.username || 'admin',
      reset_at   : new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ACTUATOR] Emergency reset error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/actuator/status/:device_id
// Status aktuator terkini per device: log terakhir, engine state, cooldown info.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status/:device_id', async (req, res) => {
  try {
    const deviceId = parseInt(req.params.device_id, 10);
    if (isNaN(deviceId)) {
      return res.status(400).json({ error: 'device_id must be a valid integer' });
    }

    const pool = getPool();
    const [[device]] = await pool.execute(
      'SELECT id, node_id, name, status FROM devices WHERE id = ?',
      [deviceId]
    );
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // 5 log aktuator terakhir
    const [recentLogs] = await pool.execute(
      `SELECT id, aksi, trigger_source, status, trigger_detail, executed_at
       FROM actuator_logs
       WHERE device_id = ?
       ORDER BY executed_at DESC
       LIMIT 5`,
      [deviceId]
    );

    const failsafeState = getDeviceState(deviceId);

    return res.json({
      device        : { id: device.id, node_id: device.node_id, name: device.name, status: device.status },
      recent_actions: recentLogs,
      failsafe      : {
        emergency_active    : failsafeState?.emergencyActive    ?? false,
        engine_stop_pending : failsafeState?.engineStopPending  ?? false,
        emergency_activated_at: failsafeState?.emergencyActivatedAt
          ? new Date(failsafeState.emergencyActivatedAt).toISOString()
          : null,
      },
      available_actions: Object.values(ACTUATOR_ACTIONS),
    });
  } catch (err) {
    console.error('[ACTUATOR] Status error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
