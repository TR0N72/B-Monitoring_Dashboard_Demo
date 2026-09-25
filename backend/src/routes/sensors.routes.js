const express = require('express');
const { getPool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

router.use(authenticate);

router.get('/latest', async (req, res) => {
  try {
    const { device_id } = req.query;
    const pool = getPool();
    
    let query = `
      SELECT sd.*, d.node_id 
      FROM sensor_data sd
      JOIN devices d ON sd.device_id = d.id
      WHERE sd.id IN (
        SELECT MAX(id) FROM sensor_data GROUP BY device_id
      )
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
      end_date
    } = req.query;
    
    const pool = getPool();
    
    let query = `
      SELECT sd.id, sd.suhu, sd.ph_level, sd.salinitas, sd.turbidity, sd.baterai, sd.rssi, sd.recorded_at, d.node_id
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

    query += ` ORDER BY sd.recorded_at DESC LIMIT 1000`;

    const [rows] = await pool.execute(query, params);

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