const express = require('express');
const { getPool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

router.use(authenticate);

// LORA-11: Process AI Detection
router.post('/', async (req, res) => {
  try {
    const { device_id, sensor_data_id, label, confidence, model_version, hsv_metadata, image_path } = req.body;
    
    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    const pool = getPool();
    
    const [devices] = await pool.execute('SELECT id FROM devices WHERE id = ? OR node_id = ?', [device_id, device_id]);
    if (devices.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const internalId = devices[0].id;
    
    const [result] = await pool.execute(
      `INSERT INTO ai_detection_logs 
       (device_id, sensor_data_id, image_path, label, confidence, model_version, hsv_metadata) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [internalId, sensor_data_id || null, image_path || null, label, confidence, model_version, JSON.stringify(hsv_metadata || {})]
    );

    // Broadcast to UI
    const { getIo } = require('../socket/alerts');
    const io = getIo();
    if (io) {
      io.emit('ai:detection', {
        id: result.insertId,
        device_id: internalId,
        label,
        confidence,
        created_at: new Date()
      });
    }

    res.status(201).json({ message: 'AI detection saved successfully', id: result.insertId });
  } catch (err) {
    console.error('[AI] Post error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// LORA-12: Get AI Detection history
router.get('/', async (req, res) => {
  try {
    const { device_id, start_date, end_date, label } = req.query;
    
    let query = `
      SELECT a.*, d.node_id 
      FROM ai_detection_logs a
      JOIN devices d ON a.device_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (device_id) {
      query += ` AND (d.node_id = ? OR d.id = ?)`;
      params.push(device_id, device_id);
    }
    if (label) {
      query += ` AND a.label = ?`;
      params.push(label);
    }
    if (start_date) {
      query += ` AND a.created_at >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND a.created_at <= ?`;
      params.push(end_date);
    }

    query += ` ORDER BY a.created_at DESC LIMIT 100`;

    const pool = getPool();
    const [rows] = await pool.execute(query, params);

    res.json({ data: rows });
  } catch (err) {
    console.error('[AI] Get history error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
