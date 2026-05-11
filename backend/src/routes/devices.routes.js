const express = require('express');
const { getPool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate);
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, device_id, name, type, mac_address, location, status, last_seen, created_at FROM devices ORDER BY created_at DESC'
    );
    res.json({ devices: rows });
  } catch (err) {
    console.error('[DEVICES] List error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, device_id, name, type, mac_address, location, status, last_seen, created_at, updated_at FROM devices WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Device not found.' });
    }
    res.json({ device: rows[0] });
  } catch (err) {
    console.error('[DEVICES] Get error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.post('/', authorize('administrator', 'operator'), async (req, res) => {
  try {
    const { device_id, name, type, mac_address, location } = req.body;
    if (!device_id || !name) {
      return res.status(400).json({ error: 'device_id and name are required.' });
    }
    const validTypes = ['sensor_node', 'gateway'];
    const deviceType = validTypes.includes(type) ? type : 'sensor_node';
    const pool = getPool();
    const [result] = await pool.execute(
      'INSERT INTO devices (device_id, name, type, mac_address, location) VALUES (?, ?, ?, ?, ?)',
      [device_id, name, deviceType, mac_address || null, location || null]
    );
    res.status(201).json({
      message: 'Device registered successfully',
      device: { id: result.insertId, device_id, name, type: deviceType },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Device ID already exists.' });
    }
    console.error('[DEVICES] Create error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.put('/:id', authorize('administrator', 'operator'), async (req, res) => {
  try {
    const { name, type, mac_address, location, status } = req.body;
    const pool = getPool();
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (type !== undefined) { fields.push('type = ?'); values.push(type); }
    if (mac_address !== undefined) { fields.push('mac_address = ?'); values.push(mac_address); }
    if (location !== undefined) { fields.push('location = ?'); values.push(location); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }
    values.push(req.params.id);
    const [result] = await pool.execute(
      `UPDATE devices SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Device not found.' });
    }
    res.json({ message: 'Device updated successfully' });
  } catch (err) {
    console.error('[DEVICES] Update error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.delete('/:id', authorize('administrator'), async (req, res) => {
  try {
    const pool = getPool();
    const [result] = await pool.execute('DELETE FROM devices WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Device not found.' });
    }
    res.json({ message: 'Device deleted successfully' });
  } catch (err) {
    console.error('[DEVICES] Delete error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
module.exports = router;
