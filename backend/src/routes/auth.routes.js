const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool } = require('../config/db');
const { authenticate, authorize, JWT_SECRET } = require('../middleware/auth');
const router = express.Router();
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    

    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, name, username, password_hash, role, kontak_telegram FROM users WHERE username = ?',
      [username]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        kontak_telegram: user.kontak_telegram,
      },
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.post('/register', authenticate, authorize('admin'), async (req, res) => {
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
    res.status(201).json({
      message: 'User registered successfully',
      user: { id: result.insertId, name, username, role: userRole, kontak_telegram },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username already registered.' });
    }
    console.error('[AUTH] Register error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.get('/me', authenticate, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, name, username, role, kontak_telegram, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('[AUTH] Profile error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
module.exports = router;