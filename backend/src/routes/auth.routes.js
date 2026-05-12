const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool } = require('../config/db');
const { authenticate, authorize, JWT_SECRET } = require('../middleware/auth');
const router = express.Router();
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = ?',
      [email]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.post('/register', authenticate, authorize('administrator'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    const validRoles = ['administrator', 'operator', 'viewer'];
    const userRole = validRoles.includes(role) ? role : 'viewer';
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const pool = getPool();
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, passwordHash, userRole]
    );
    res.status(201).json({
      message: 'User registered successfully',
      user: { id: result.insertId, name, email, role: userRole },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already registered.' });
    }
    console.error('[AUTH] Register error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.get('/me', authenticate, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
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