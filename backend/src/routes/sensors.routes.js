const express = require('express');
const { getPool } = require('../config/db');
const { endOfDay } = require('../services/dateRange');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

router.use(authenticate);

// Keputusan DSS terbaru per perangkat, ikut dikirim agar dashboard tidak perlu request per node.
const DSS_COLS = `
  (SELECT f.dss_score FROM fuzzy_decisions f WHERE f.device_id = sd.device_id ORDER BY f.id DESC LIMIT 1) AS dss_score,
  (SELECT f.dss_recommendation FROM fuzzy_decisions f WHERE f.device_id = sd.device_id ORDER BY f.id DESC LIMIT 1) AS dss_recommendation`;

// Deteksi visual terbaru per perangkat (kartu dashboard).
const AI_COLS = `,
  (SELECT a.label FROM ai_detection_logs a WHERE a.device_id = sd.device_id ORDER BY a.id DESC LIMIT 1) AS ai_label,
  (SELECT a.confidence FROM ai_detection_logs a WHERE a.device_id = sd.device_id ORDER BY a.id DESC LIMIT 1) AS ai_confidence,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(a.hsv_metadata, '$.predicted_class')) FROM ai_detection_logs a WHERE a.device_id = sd.device_id ORDER BY a.id DESC LIMIT 1) AS ai_class,
  (SELECT a.created_at FROM ai_detection_logs a WHERE a.device_id = sd.device_id ORDER BY a.id DESC LIMIT 1) AS ai_at`;

router.get('/latest', async (req, res) => {
  try {
    const { device_id } = req.query;
    const pool = getPool();
    
    let query;
    const params = [];

    if (device_id) {
      if (!isNaN(device_id)) {
        query = `
          SELECT sd.*, d.node_id,${DSS_COLS}${AI_COLS}
          FROM sensor_data sd
          JOIN devices d ON sd.device_id = d.id
          WHERE (d.node_id = ? OR d.id = ?)
          ORDER BY sd.id DESC
          LIMIT 1
        `;
        params.push(device_id, device_id);
      } else {
        query = `
          SELECT sd.*, d.node_id,${DSS_COLS}${AI_COLS}
          FROM sensor_data sd
          JOIN devices d ON sd.device_id = d.id
          WHERE d.node_id = ?
          ORDER BY sd.id DESC
          LIMIT 1
        `;
        params.push(device_id);
      }
    } else {
      query = `
        SELECT sd.*, d.node_id,${DSS_COLS}${AI_COLS}
        FROM sensor_data sd
        JOIN devices d ON sd.device_id = d.id
        INNER JOIN (
          SELECT device_id, MAX(id) AS max_id
          FROM sensor_data
          GROUP BY device_id
        ) latest ON sd.id = latest.max_id
      `;
    }

    const [rows] = await pool.execute(query, params);
    res.json({ readings: rows });
  } catch (err) {
    console.error('[SENSORS] Latest error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const {
      device_id,
      parameter,
      start_date,
      end_date,
      limit,
    } = req.query;
    
    const pool = getPool();
    
    let query = `
      SELECT sd.id, sd.suhu, sd.salinitas, sd.turbidity, sd.baterai, sd.rssi, sd.seq, sd.jarak_cm, sd.adc, sd.siklus_status, sd.recorded_at, d.node_id
      FROM sensor_data sd
      JOIN devices d ON sd.device_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (device_id) {
      if (!isNaN(device_id)) {
        query += ` AND (d.node_id = ? OR d.id = ?)`;
        params.push(device_id, device_id);
      } else {
        query += ` AND d.node_id = ?`;
        params.push(device_id);
      }
    }
    if (start_date) {
      query += ` AND sd.recorded_at >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND sd.recorded_at <= ?`;
      params.push(endOfDay(end_date));
    }

    const parsedLimit = limit ? parseInt(limit, 10) : 1000;
    const finalLimit = isNaN(parsedLimit) ? 1000 : Math.max(1, Math.min(1000, parsedLimit));

    query += ` ORDER BY sd.recorded_at DESC LIMIT ?`;
    params.push(Number(finalLimit));

    const [rows] = await pool.query(query, params);

    if (parameter && ['suhu', 'salinitas', 'turbidity', 'baterai', 'rssi', 'jarak_cm'].includes(parameter)) {
      const mappedData = rows.map(r => ({
        _time: r.recorded_at,
        _value: r[parameter],
        device_id: r.node_id,
        _field: parameter
      }));
      return res.json({ data: mappedData, query: { device_id, parameter, start_date, end_date } });
    }

    res.json({
      data: rows,
      query: { device_id, parameter, start_date, end_date },
    });
  } catch (err) {
    console.error('[SENSORS] History error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Agregasi statistik per rentang waktu: rata-rata/min/maks + tren (paruh akhir vs paruh awal) + ringkasan per node.
const STAT_COLS = ['suhu', 'jarak_cm', 'salinitas', 'turbidity'];  // konstanta, bukan input user
const RANGE_MS = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };
const round = (v, n = 2) => (v == null ? null : Math.round(Number(v) * 10 ** n) / 10 ** n);

router.get('/stats', async (req, res) => {
  try {
    const range = String(req.query.range || '24h').toLowerCase();
    if (!(range in RANGE_MS) && range !== 'all') {
      return res.status(400).json({ error: "range harus '24h', '7d', '30d', atau 'all'." });
    }
    const pool = getPool();
    const nowMs = Date.now();
    let startMs;
    if (range === 'all') {
      const [[m]] = await pool.execute('SELECT UNIX_TIMESTAMP(MIN(recorded_at)) AS t FROM sensor_data');
      startMs = m.t == null ? nowMs : Number(m.t) * 1000;
    } else {
      startMs = nowMs - RANGE_MS[range];
    }
    const midMs = startMs + (nowMs - startMs) / 2;
    const start = new Date(startMs), mid = new Date(midMs);

    const agg = STAT_COLS.map((c) =>
      `AVG(${c}) AS ${c}_avg, MIN(${c}) AS ${c}_min, MAX(${c}) AS ${c}_max, COUNT(${c}) AS ${c}_n, ` +
      `AVG(CASE WHEN recorded_at <  ? THEN ${c} END) AS ${c}_old, AVG(CASE WHEN recorded_at >= ? THEN ${c} END) AS ${c}_new`
    ).join(', ');
    const tsParams = STAT_COLS.flatMap(() => [mid, mid]);

    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS samples, ${agg} FROM sensor_data WHERE recorded_at >= ?`, [...tsParams, start]);

    const metrics = {};
    for (const c of STAT_COLS) {
      const oldAvg = row[`${c}_old`], newAvg = row[`${c}_new`];
      let trend = 'stable', changePct = null;
      if (oldAvg != null && newAvg != null && Number(oldAvg) !== 0) {
        changePct = ((Number(newAvg) - Number(oldAvg)) / Math.abs(Number(oldAvg))) * 100;
        if (changePct > 5) trend = 'up'; else if (changePct < -5) trend = 'down';
      }
      metrics[c] = {
        avg: round(row[`${c}_avg`]), min: round(row[`${c}_min`]), max: round(row[`${c}_max`]),
        count: Number(row[`${c}_n`]), trend, change_pct: round(changePct, 1),
      };
    }

    const nodeAgg = STAT_COLS.map((c) => `AVG(sd.${c}) AS ${c}`).join(', ');
    const [nodeRows] = await pool.execute(
      `SELECT d.node_id, d.name, d.status, COUNT(sd.id) AS samples, ${nodeAgg}
         FROM devices d LEFT JOIN sensor_data sd ON sd.device_id = d.id AND sd.recorded_at >= ?
        WHERE d.type = 'sensor_node' GROUP BY d.id, d.node_id, d.name, d.status ORDER BY d.node_id`, [start]);
    const nodes = nodeRows.map((n) => ({
      node_id: n.node_id, name: n.name, online: n.status === 'online', samples: Number(n.samples),
      ...Object.fromEntries(STAT_COLS.map((c) => [c, round(n[c])])),
    }));

    res.json({ range, from: start.toISOString(), to: new Date(nowMs).toISOString(), samples: Number(row.samples), metrics, nodes });
  } catch (err) {
    console.error('[SENSORS] Stats error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;