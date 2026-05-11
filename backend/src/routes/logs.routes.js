const express = require('express');
const { getPool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate);
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      level,
      device_id,
      start_date,
      end_date,
    } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const pageLimit = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const conditions = [];
    const params = [];
    if (level) {
      conditions.push('al.level_peringatan = ?');
      params.push(level);
    }
    if (device_id) {
      conditions.push('al.device_id = ?');
      params.push(device_id);
    }
    if (start_date) {
      conditions.push('al.created_at >= ?');
      params.push(start_date);
    }
    if (end_date) {
      conditions.push('al.created_at <= ?');
      params.push(end_date);
    }
    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';
    const pool = getPool();
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM alert_logs al ${whereClause}`,
      params
    );
    const total = countResult[0].total;
    const [rows] = await pool.execute(`
      SELECT
        al.id, al.parameter, al.measured_value, al.threshold_min, al.threshold_max,
        al.level_peringatan, al.pesan_notifikasi, al.acknowledged, al.created_at,
        d.device_id AS hardware_id, d.name AS device_name,
        u.name AS acknowledged_by_name
      FROM alert_logs al
      JOIN devices d ON al.device_id = d.id
      LEFT JOIN users u ON al.acknowledged_by = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, String(pageLimit), String(offset)]);
    res.json({
      logs: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit),
      },
    });
  } catch (err) {
    console.error('[LOGS] List error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.get('/export', async (req, res) => {
  try {
    const { start_date, end_date, device_id } = req.query;
    const conditions = [];
    const params = [];
    if (device_id) {
      conditions.push('al.device_id = ?');
      params.push(device_id);
    }
    if (start_date) {
      conditions.push('al.created_at >= ?');
      params.push(start_date);
    }
    if (end_date) {
      conditions.push('al.created_at <= ?');
      params.push(end_date);
    }
    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';
    const pool = getPool();
    const [rows] = await pool.execute(`
      SELECT
        al.id, d.device_id AS hardware_id, d.name AS device_name,
        al.parameter, al.measured_value, al.threshold_min, al.threshold_max,
        al.level_peringatan, al.pesan_notifikasi, al.acknowledged, al.created_at
      FROM alert_logs al
      JOIN devices d ON al.device_id = d.id
      ${whereClause}
      ORDER BY al.created_at DESC
    `, params);
    const headers = [
      'ID', 'Hardware ID', 'Device Name', 'Parameter', 'Measured Value',
      'Threshold Min', 'Threshold Max', 'Level', 'Message', 'Acknowledged', 'Timestamp'
    ];
    const csvLines = [headers.join(',')];
    for (const row of rows) {
      csvLines.push([
        row.id,
        `"${row.hardware_id}"`,
        `"${row.device_name}"`,
        row.parameter,
        row.measured_value,
        row.threshold_min,
        row.threshold_max,
        row.level_peringatan,
        `"${row.pesan_notifikasi.replace(/"/g, '""')}"`,
        row.acknowledged ? 'Yes' : 'No',
        row.created_at,
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=bmonitor_logs_${Date.now()}.csv`);
    res.send(csvLines.join('\n'));
  } catch (err) {
    console.error('[LOGS] Export error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
module.exports = router;
