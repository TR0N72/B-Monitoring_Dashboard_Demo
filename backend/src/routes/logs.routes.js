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
    const pageLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * pageLimit;
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
    const [rows] = await pool.query(`
      SELECT
        al.id, al.parameter, al.measured_value, al.threshold_min, al.threshold_max,
        al.level_peringatan, al.pesan_notifikasi, al.acknowledged, al.created_at,
        d.node_id AS hardware_id, d.name AS device_name,
        u.name AS acknowledged_by_name
      FROM alert_logs al
      JOIN devices d ON al.device_id = d.id
      LEFT JOIN users u ON al.acknowledged_by = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, Number(pageLimit), Number(offset)]);
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
    const { start_date, end_date, device_id, type = 'telemetry' } = req.query;
    const isTelemetry = type === 'telemetry';
    const prefix = isTelemetry ? 'sd' : 'al';
    const timeCol = isTelemetry ? 'recorded_at' : 'created_at';

    const conditions = [];
    const params = [];
    if (device_id) {
      conditions.push(`${prefix}.device_id = ?`);
      params.push(device_id);
    }
    if (start_date) {
      conditions.push(`${prefix}.${timeCol} >= ?`);
      params.push(start_date.length === 10 ? `${start_date} 00:00:00` : start_date);
    }
    if (end_date) {
      conditions.push(`${prefix}.${timeCol} <= ?`);
      params.push(end_date.length === 10 ? `${end_date} 23:59:59` : end_date);
    }
    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';
    const pool = getPool();

    if (isTelemetry) {
      const [rows] = await pool.execute(`
        SELECT
          sd.id, d.node_id AS hardware_id, d.name AS device_name,
          sd.suhu, sd.salinitas, sd.turbidity, sd.baterai, sd.rssi, sd.jarak_cm, sd.recorded_at
        FROM sensor_data sd
        JOIN devices d ON sd.device_id = d.id
        ${whereClause}
        ORDER BY sd.recorded_at DESC
        LIMIT 10000
      `, params);

      // Optional `columns` (csv of sensor keys) limits sensor columns; identity columns always kept.
      const sensorCols = [
        ['suhu', 'Suhu (C)', 'suhu'], ['salinitas', 'Salinitas (ppt)', 'salinitas'],
        ['turbidity', 'Turbidity (NTU)', 'turbidity'],
        ['baterai', 'Battery (%)', 'baterai'], ['rssi', 'RSSI (dBm)', 'rssi'],
        ['jarak', 'Jarak Air (cm)', 'jarak_cm'],
      ];
      const aliases = { temperature: 'suhu', salinity: 'salinitas' };
      const wanted = typeof req.query.columns === 'string' && req.query.columns
        ? new Set(req.query.columns.split(',').map((c) => aliases[c.trim()] || c.trim()))
        : null;
      const picked = sensorCols.filter(([k]) => !wanted || wanted.has(k));
      const headers = ['ID', 'Hardware ID', 'Device Name', ...picked.map((c) => c[1]), 'Timestamp'];
      const csvLines = [headers.join(',')];
      for (const row of rows) {
        const hwId = (row.hardware_id || '').replace(/"/g, '""');
        const devName = (row.device_name || '').replace(/"/g, '""');
        csvLines.push([
          row.id,
          `"${hwId}"`,
          `"${devName}"`,
          ...picked.map((c) => row[c[2]] ?? ''),
          row.recorded_at,
        ].join(','));
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=bmonitor_telemetry_${Date.now()}.csv`);
      return res.send(csvLines.join('\n'));
    }

    const [rows] = await pool.query(`
      SELECT
        al.id, d.node_id AS hardware_id, d.name AS device_name,
        al.parameter, al.measured_value, al.threshold_min, al.threshold_max,
        al.level_peringatan, al.pesan_notifikasi, al.acknowledged, al.created_at
      FROM alert_logs al
      JOIN devices d ON al.device_id = d.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT 10000
    `, params);
    const headers = [
      'ID', 'Hardware ID', 'Device Name', 'Parameter', 'Measured Value',
      'Threshold Min', 'Threshold Max', 'Level', 'Message', 'Acknowledged', 'Timestamp'
    ];
    const csvLines = [headers.join(',')];
    for (const row of rows) {
      const msg = (row.pesan_notifikasi || '').replace(/"/g, '""');
      const hwId = (row.hardware_id || '').replace(/"/g, '""');
      const devName = (row.device_name || '').replace(/"/g, '""');
      csvLines.push([
        row.id,
        `"${hwId}"`,
        `"${devName}"`,
        row.parameter || '',
        row.measured_value ?? '',
        row.threshold_min ?? '',
        row.threshold_max ?? '',
        row.level_peringatan || '',
        `"${msg}"`,
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