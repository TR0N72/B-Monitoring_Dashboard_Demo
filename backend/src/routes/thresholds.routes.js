const express = require('express');
const { getPool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate);
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(`
      SELECT
        tc.id, tc.parameter, tc.batas_bawah, tc.batas_atas, tc.updated_at,
        d.device_id AS hardware_id, d.name AS device_name,
        u.name AS modified_by
      FROM threshold_config tc
      JOIN devices d ON tc.device_id = d.id
      JOIN users u ON tc.user_id = u.id
      ORDER BY d.id, tc.parameter
    `);
    res.json({ thresholds: rows });
  } catch (err) {
    console.error('[THRESHOLDS] List error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.get('/:deviceId', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(`
      SELECT
        tc.id, tc.parameter, tc.batas_bawah, tc.batas_atas, tc.updated_at,
        u.name AS modified_by
      FROM threshold_config tc
      JOIN users u ON tc.user_id = u.id
      WHERE tc.device_id = ?
      ORDER BY tc.parameter
    `, [req.params.deviceId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No thresholds found for this device.' });
    }
    res.json({ thresholds: rows });
  } catch (err) {
    console.error('[THRESHOLDS] Get error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.put('/:deviceId', authorize('administrator', 'operator'), async (req, res) => {
  try {
    const { thresholds } = req.body;
    const deviceId = req.params.deviceId;
    if (!Array.isArray(thresholds) || thresholds.length === 0) {
      return res.status(400).json({ error: 'thresholds array is required.' });
    }
    const validParams = ['suhu', 'ph', 'salinitas', 'kekeruhan'];
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const t of thresholds) {
        if (!validParams.includes(t.parameter)) {
          await connection.rollback();
          return res.status(400).json({ error: `Invalid parameter: ${t.parameter}` });
        }
        if (t.batas_bawah === undefined || t.batas_atas === undefined) {
          await connection.rollback();
          return res.status(400).json({ error: `batas_bawah and batas_atas required for ${t.parameter}` });
        }
        if (Number(t.batas_bawah) >= Number(t.batas_atas)) {
          await connection.rollback();
          return res.status(400).json({ error: `batas_bawah must be less than batas_atas for ${t.parameter}` });
        }
        await connection.execute(`
          INSERT INTO threshold_config (device_id, user_id, parameter, batas_bawah, batas_atas)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            batas_bawah = VALUES(batas_bawah),
            batas_atas = VALUES(batas_atas),
            user_id = VALUES(user_id)
        `, [deviceId, req.user.id, t.parameter, t.batas_bawah, t.batas_atas]);
      }
      await connection.commit();
      res.json({ message: 'Thresholds updated successfully' });
    } catch (innerErr) {
      await connection.rollback();
      throw innerErr;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('[THRESHOLDS] Update error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
module.exports = router;