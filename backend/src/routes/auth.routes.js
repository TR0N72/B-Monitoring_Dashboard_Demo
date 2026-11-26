const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { getPool } = require('../config/db');
const { authenticate, authorize, JWT_SECRET } = require('../middleware/auth');
const { revoke } = require('../services/tokenBlacklist');
const { passwordError } = require('../services/passwordPolicy');
const { invalidate } = require('../services/userGuard');
const router = express.Router();

// Max 10 login attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
  skipSuccessfulRequests: true, // Only count failed requests
});

router.post('/login', loginLimiter, async (req, res) => {
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
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h', jwtid: require('crypto').randomUUID() }
    );
    const isSecure = req.secure; // https langsung atau via proxy (TRUST_PROXY)
    res.cookie('bmonitor_token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'Strict' : 'Lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000, // 24h
    });
    res.json({
      message: 'Login successful',
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
router.post('/logout', async (req, res) => {
  const auth = req.headers.authorization;
  const token = req.cookies?.bmonitor_token || (auth && auth.startsWith('Bearer ') ? auth.split(' ')[1] : null);
  if (token) {
    const decoded = jwt.decode(token);
    // Hanya token yang tanda tangannya valid yang dicatat (cegah isi blacklist dengan sampah)
    try { jwt.verify(token, JWT_SECRET); await revoke(token, decoded && decoded.exp); } catch (e) { /* kedaluwarsa/invalid: abaikan */ }
  }
  res.clearCookie('bmonitor_token', { httpOnly: true, sameSite: 'Lax', path: '/' });
  res.json({ message: 'Logged out successfully.' });
});
router.post('/register', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, username, password, role, kontak_telegram } = req.body;
    if (!name || !username || !password) {
      return res.status(400).json({ error: 'Name, username, and password are required.' });
    }
    const pwErr = passwordError(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
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

// Password reset sends a 6-digit one-time code to kontak_telegram (no SMTP dependency).
// Existing JWTs stay valid until expiration (no per-user token_version).
const crypto = require('crypto');
const RESET_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const codeHash = (uid, code) => crypto.createHmac('sha256', JWT_SECRET).update(`${uid}:${code}`).digest('hex');
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' },
});

// In-memory per-username cooldown (resets on restart, single instance); move to DB when scaling.
const FORGOT_COOLDOWN_MS = 60 * 1000;
const lastForgot = new Map();

router.post('/forgot', resetLimiter, async (req, res) => {
  // Respons selalu sama agar username tak bisa ditebak (anti-enumerasi).
  const generic = { message: 'Jika akun terdaftar dan punya kontak Telegram, kode reset telah dikirim.' };
  try {
    const { username } = req.body || {};
    if (typeof username !== 'string' || !username) return res.status(400).json({ error: 'Username is required.' });
    // Cooldown per username: limiter per IP tak cegah spam Telegram ke satu korban dari banyak IP.
    const now = Date.now();
    if (now - (lastForgot.get(username) || 0) < FORGOT_COOLDOWN_MS) return res.json(generic);
    lastForgot.set(username, now);
    if (lastForgot.size > 1000) for (const [k, t] of lastForgot) if (now - t >= FORGOT_COOLDOWN_MS) lastForgot.delete(k);
    const pool = getPool();
    const [rows] = await pool.execute('SELECT id, kontak_telegram FROM users WHERE username = ?', [username]);
    if (rows.length && rows[0].kontak_telegram) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      await pool.execute(
        `INSERT INTO password_resets (user_id, code_hash, expires_at, attempts)
         VALUES (?, ?, NOW() + INTERVAL ${RESET_TTL_MIN} MINUTE, 0)
         ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), expires_at = VALUES(expires_at), attempts = 0`,
        [rows[0].id, codeHash(rows[0].id, code)]);
      require('../config/telegramQueue')
        .sendToChat(rows[0].kontak_telegram, `Kode reset password B-Monitor: <code>${code}</code>\nBerlaku ${RESET_TTL_MIN} menit. Abaikan bila bukan Anda.`, 'HTML')
        .catch((e) => console.error('[AUTH] kirim kode reset gagal:', e.message));
    }
    res.json(generic);
  } catch (err) {
    console.error('[AUTH] Forgot error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.post('/reset', resetLimiter, async (req, res) => {
  try {
    const { username, code, password } = req.body || {};
    if (![username, code, password].every((v) => typeof v === 'string' && v)) {
      return res.status(400).json({ error: 'Username, code, and new password are required.' });
    }
    const pwErr = passwordError(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const bad = { error: 'Kode salah atau kedaluwarsa.' };
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT u.id, r.code_hash, r.attempts, r.expires_at > NOW() AS valid
         FROM users u JOIN password_resets r ON r.user_id = u.id WHERE u.username = ?`, [username]);
    if (!rows.length || !rows[0].valid || rows[0].attempts >= MAX_ATTEMPTS) return res.status(400).json(bad);
    const { id, code_hash } = rows[0];
    const ok = crypto.timingSafeEqual(Buffer.from(codeHash(id, code)), Buffer.from(code_hash));
    if (!ok) {
      await pool.execute('UPDATE password_resets SET attempts = attempts + 1 WHERE user_id = ?', [id]);
      return res.status(400).json(bad);
    }
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 10), id]);
    await pool.execute('DELETE FROM password_resets WHERE user_id = ?', [id]);
    invalidate(id); // updated_at berubah -> JWT lama ditolak
    res.json({ message: 'Password diperbarui. Silakan login.' });
  } catch (err) {
    console.error('[AUTH] Reset error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;