const express = require('express');
const { getPool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate);
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, node_id, name, type, mac_address, lokasi, status, last_seen, created_at FROM devices ORDER BY created_at DESC'
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
      'SELECT id, node_id, name, type, mac_address, lokasi, status, last_seen, created_at, updated_at FROM devices WHERE id = ? OR node_id = ?',
      [req.params.id, req.params.id]
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
router.post('/', authorize('admin'), async (req, res) => {
  try {
    const { node_id, name, type, mac_address, lokasi } = req.body;
    if (!node_id || !name) {
      return res.status(400).json({ error: 'node_id and name are required.' });
    }
    const validTypes = ['sensor_node', 'gateway'];
    const deviceType = validTypes.includes(type) ? type : 'sensor_node';
    const pool = getPool();
    const [result] = await pool.execute(
      'INSERT INTO devices (node_id, name, type, mac_address, lokasi) VALUES (?, ?, ?, ?, ?)',
      [node_id, name, deviceType, mac_address || null, lokasi || null]
    );
    res.status(201).json({
      message: 'Device registered successfully',
      device: { id: result.insertId, node_id, name, type: deviceType },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Node ID already exists.' });
    }
    console.error('[DEVICES] Create error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.put('/:id', authorize('admin'), async (req, res) => {
  try {
    const { name, type, mac_address, lokasi, status } = req.body;
    // node_id sengaja tak bisa diubah: dipakai sebagai topik MQTT dan relasi data
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 100)) {
      return res.status(400).json({ error: 'name must be 1-100 characters.' });
    }
    if (type !== undefined && !['sensor_node', 'gateway'].includes(type)) {
      return res.status(400).json({ error: 'type must be sensor_node or gateway.' });
    }
    if (status !== undefined && !['online', 'offline', 'maintenance'].includes(status)) {
      return res.status(400).json({ error: 'status must be online, offline or maintenance.' });
    }
    if (mac_address && !/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac_address)) {
      return res.status(400).json({ error: 'mac_address must look like AA:BB:CC:DD:EE:FF.' });
    }
    if (lokasi && (typeof lokasi !== 'string' || lokasi.length > 255)) {
      return res.status(400).json({ error: 'lokasi must be at most 255 characters.' });
    }
    const pool = getPool();
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
    if (type !== undefined) { fields.push('type = ?'); values.push(type); }
    if (mac_address !== undefined) { fields.push('mac_address = ?'); values.push(mac_address || null); }
    if (lokasi !== undefined) { fields.push('lokasi = ?'); values.push(lokasi || null); }
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
router.delete('/:id', authorize('admin'), async (req, res) => {
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