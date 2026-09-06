const express = require('express');
const { getPool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const { device_id, start_date, end_date } = req.query;
    
    let query = `
      SELECT f.*, d.node_id 
      FROM fuzzy_decisions f
      JOIN devices d ON f.device_id = d.id
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
      query += ` AND f.created_at >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND f.created_at <= ?`;
      params.push(end_date);
    }

    query += ` ORDER BY f.created_at DESC LIMIT 100`;

    const pool = getPool();
    const [rows] = await pool.execute(query, params);

    res.json({ data: rows });
  } catch (err) {
    console.error('[DSS] Get history error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
