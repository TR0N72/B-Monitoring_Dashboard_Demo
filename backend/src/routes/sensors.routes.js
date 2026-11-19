const express = require('express');
const { getPool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

router.use(authenticate);

// Keputusan DSS terbaru per perangkat, ikut dikirim agar dashboard tidak perlu request per node.
const DSS_COLS = `
  (SELECT f.dss_score FROM fuzzy_decisions f WHERE f.device_id = sd.device_id ORDER BY f.id DESC LIMIT 1) AS dss_score,
  (SELECT f.dss_recommendation FROM fuzzy_decisions f WHERE f.device_id = sd.device_id ORDER BY f.id DESC LIMIT 1) AS dss_recommendation`;

router.get('/latest', async (req, res) => {
  try {
    const { device_id } = req.query;
    const pool = getPool();
    
    let query;
    const params = [];

    if (device_id) {
      if (!isNaN(device_id)) {
        query = `
          SELECT sd.*, d.node_id,${DSS_COLS}
          FROM sensor_data sd
          JOIN devices d ON sd.device_id = d.id
          WHERE (d.node_id = ? OR d.id = ?)
          ORDER BY sd.id DESC
          LIMIT 1
        `;
        params.push(device_id, device_id);
      } else {
        query = `
          SELECT sd.*, d.node_id,${DSS_COLS}
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
        SELECT sd.*, d.node_id,${DSS_COLS}
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
      SELECT sd.id, sd.suhu, sd.ph_level, sd.salinitas, sd.turbidity, sd.baterai, sd.rssi, sd.seq, sd.jarak_cm, sd.adc, sd.siklus_status, sd.recorded_at, d.node_id
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
      params.push(end_date);
    }

    const parsedLimit = limit ? parseInt(limit, 10) : 1000;
    const finalLimit = isNaN(parsedLimit) ? 1000 : Math.max(1, Math.min(1000, parsedLimit));

    query += ` ORDER BY sd.recorded_at DESC LIMIT ?`;
    params.push(Number(finalLimit));

    const [rows] = await pool.query(query, params);

    if (parameter && ['suhu', 'ph_level', 'salinitas', 'turbidity', 'baterai', 'rssi'].includes(parameter)) {
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

module.exports = router;