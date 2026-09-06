const express = require('express');
const bcrypt  = require('bcryptjs');
const { getPool }         = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { invalidateRouteCache }    = require('../config/telegramQueue');
const router = express.Router();

router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, name, username, email, role, kontak_telegram, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ users: rows });
  } catch (err) {
    console.error('[USERS] Fetch error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.post('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, username, password, role, kontak_telegram } = req.body;
    if (!name || !username || !password) {
      return res.status(400).json({ error: 'Name, username, and password are required.' });
    }
    const validRoles = ['admin', 'user'];
    const userRole = validRoles.includes(role) ? role : 'user';
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const pool = getPool();
    const [result] = await pool.execute(
      'INSERT INTO users (name, username, password_hash, role, kontak_telegram) VALUES (?, ?, ?, ?, ?)',
      [name, username, passwordHash, userRole, kontak_telegram || null]
    );
    // Invalidasi cache routing Telegram agar pekerja baru langsung menerima alert
    invalidateRouteCache();

    res.status(201).json({
      message: 'User created successfully',
      user: { id: result.insertId, name, username, role: userRole, kontak_telegram },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username already registered.' });
    }
    console.error('[USERS] Create error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, username, password, role, kontak_telegram } = req.body;
    
    if (!name || !username) {
      return res.status(400).json({ error: 'Name and username are required.' });
    }

    const validRoles = ['admin', 'user'];
    const userRole = validRoles.includes(role) ? role : 'user';
    
    const pool = getPool();
    
    const [existing] = await pool.execute('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Username already in use by another account.' });
    }

    if (password) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      await pool.execute(
        'UPDATE users SET name = ?, username = ?, password_hash = ?, role = ?, kontak_telegram = ? WHERE id = ?',
        [name, username, passwordHash, userRole, kontak_telegram || null, id]
      );
    } else {
      await pool.execute(
        'UPDATE users SET name = ?, username = ?, role = ?, kontak_telegram = ? WHERE id = ?',
        [name, username, userRole, kontak_telegram || null, id]
      );
    }
    
    // Invalidasi cache routing Telegram agar perubahan kontak langsung berlaku
    invalidateRouteCache();

    res.json({ message: 'User updated successfully' });
  } catch (err) {
    console.error('[USERS] Update error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    
    if (parseInt(id) === req.user.id) {
      return res.status(403).json({ error: 'You cannot delete your own account.' });
    }

    const pool = getPool();
    const [result] = await pool.execute('DELETE FROM users WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    
    // Invalidasi cache routing Telegram agar user yang dihapus tidak lagi menerima alert
    invalidateRouteCache();

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('[USERS] Delete error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
