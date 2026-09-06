const express = require('express');
const { getPool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { publishMQTT } = require('../config/mqtt');
const router = express.Router();

router.use(authenticate);

router.post('/command', authorize('admin'), async (req, res) => {
  try {
    const { device_id, aksi } = req.body; 
    
    if (!device_id || !aksi) {
      return res.status(400).json({ error: 'device_id and aksi are required' });
    }

    const pool = getPool();
    
    let getDeviceQuery = 'SELECT id, node_id FROM devices WHERE node_id = ?';
    let getDeviceParams = [device_id];
    if (!isNaN(device_id)) {
      getDeviceQuery += ' OR id = ?';
      getDeviceParams.push(device_id);
    }
    const [devices] = await pool.execute(getDeviceQuery, getDeviceParams);
    if (devices.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const internalId = devices[0].id;
    const nodeId = devices[0].node_id;

    const [result] = await pool.execute(
      `INSERT INTO actuator_logs (device_id, aksi, trigger_source, status) VALUES (?, ?, ?, ?)`,
      [internalId, aksi, 'manual', 'pending']
    );

    publishMQTT(`tambak/${nodeId}/actuator/command`, { aksi, command_id: result.insertId }, { qos: 1 });

    res.status(202).json({ message: 'Command sent', command_id: result.insertId });
  } catch (err) {
    console.error('[ACTUATOR] Command error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.get('/logs', async (req, res) => {
  try {
    const { device_id, start_date, end_date } = req.query;
    
    let query = `
      SELECT a.*, d.node_id 
      FROM actuator_logs a
      JOIN devices d ON a.device_id = d.id
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
      query += ` AND a.executed_at >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND a.executed_at <= ?`;
      params.push(end_date);
    }

    query += ` ORDER BY a.executed_at DESC LIMIT 100`;

    const pool = getPool();
    const [rows] = await pool.execute(query, params);

    res.json({ data: rows });
  } catch (err) {
    console.error('[ACTUATOR] Get logs error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
