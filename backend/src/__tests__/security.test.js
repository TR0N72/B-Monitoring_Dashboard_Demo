'use strict';
/**
 * Security & RBAC Testing — B-Monitor API
 * ==========================================
 * Menguji keamanan API secara menyeluruh meliputi:
 *
 *  1. JWT Authentication  — no token, expired, tampered, malformed
 *  2. RBAC Authorization  — user mengakses endpoint admin-only
 *  3. Privilege Escalation — self-signed token dengan role admin
 *  4. Endpoint Protection  — semua route kritis terlindungi
 *  5. Input Validation    — body yang tidak lengkap / tidak valid
 *  6. Sensitive Data Exposure — password_hash tidak pernah muncul di response
 *
 * Catatan: Test berjalan TANPA server/MySQL/MQTT yang aktif.
 */

const JWT_SECRET = 'bmonitor_dev_secret';
process.env.JWT_SECRET = JWT_SECRET;

// ── Mock semua dependency eksternal SEBELUM require apapun ───────────────────
const mockExecute = jest.fn();
const mockPool    = { execute: mockExecute };

jest.mock('../config/db', () => ({
  getPool:    jest.fn(() => mockPool),
  initMySQL:  jest.fn().mockResolvedValue(undefined),
  closeMySQL: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../config/mqtt', () => ({
  initMQTT:      jest.fn().mockResolvedValue(undefined),
  closeMQTT:     jest.fn().mockResolvedValue(undefined),
  publishMQTT:   jest.fn().mockResolvedValue(undefined),
  getMQTTClient: jest.fn(() => null),
}));
jest.mock('../config/telegram', () => ({ verifyBot: jest.fn() }));
jest.mock('../config/telegramQueue', () => ({
  invalidateRouteCache: jest.fn(),
  getQueueStatus:       jest.fn(() => ({ queueLength: 0, workers: [] })),
}));
jest.mock('../socket/alerts', () => ({
  initSocket: jest.fn(),
  emitAlert:  jest.fn(),
}));
jest.mock('../services/emergencyState', () => ({
  getAllEmergencyStates: jest.fn(() => ({})),
  resetEmergencyState:  jest.fn(),
  getDeviceState:       jest.fn(() => ({ emergency: false, last_updated: null })),
}));
jest.mock('../services/actuatorController', () => ({
  ACTUATOR_ACTIONS: {
    AERATOR_ON: 'AERATOR_ON', AERATOR_OFF: 'AERATOR_OFF',
    PUMP_ON: 'PUMP_ON',       PUMP_OFF: 'PUMP_OFF',
  },
  sendActuatorCommand:  jest.fn().mockResolvedValue(42),
  sendCommandSequence:  jest.fn().mockResolvedValue([42, 43]),
}));

// ── Import setelah semua mock terpasang ──────────────────────────────────────
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');

// ── Build Express app (satu kali, dipakai semua suite) ───────────────────────
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use('/api/auth',              require('../routes/auth.routes'));
app.use('/api/devices',           require('../routes/devices.routes'));
app.use('/api/users',             require('../routes/users.routes'));
app.use('/api/actuator',          require('../routes/actuator.routes'));
app.use('/api/dss',               require('../routes/fuzzy.routes'));
app.use('/api/config/thresholds', require('../routes/thresholds.routes'));
app.use('/api/notifications',     require('../routes/notifications.routes'));
app.use('/api/logs',              require('../routes/logs.routes'));
app.use('/api/sensors',           require('../routes/sensors.routes'));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Helper: buat JWT token ────────────────────────────────────────────────────
function makeToken(role = 'user', overrides = {}) {
  const payload = { id: 1, username: role === 'admin' ? 'admin' : 'petambak', role, ...overrides };
  return `Bearer ${jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })}`;
}
function makeExpiredToken(role = 'user') {
  return `Bearer ${jwt.sign({ id: 1, username: 'x', role }, JWT_SECRET, { expiresIn: '-1s' })}`;
}
function makeTamperedToken() {
  return `Bearer ${jwt.sign({ id: 1, username: 'hacker', role: 'admin' }, 'wrong_secret_lol', { expiresIn: '1h' })}`;
}
function makeSelfSignedAdminToken() {
  return `Bearer ${jwt.sign({ id: 99, username: 'evil', role: 'admin' }, 'not_the_real_key', { expiresIn: '1h' })}`;
}

beforeEach(() => { mockExecute.mockReset(); });

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: Public Endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe('✅ Public Endpoints', () => {
  test('GET /api/health → 200 (no auth required)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('POST /api/auth/login dengan credentials valid → 200 + token', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    mockExecute.mockResolvedValueOnce([[{
      id: 1, name: 'Admin', username: 'admin',
      password_hash: passwordHash, role: 'admin', kontak_telegram: null,
    }], {}]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).not.toHaveProperty('password_hash');
    const decoded = jwt.verify(res.body.token, JWT_SECRET);
    expect(decoded.role).toBe('admin');
  });

  test('POST /api/auth/login tanpa body → 400', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/auth/login password salah → 401', async () => {
    const passwordHash = await bcrypt.hash('benar123', 10);
    mockExecute.mockResolvedValueOnce([[{
      id: 1, username: 'admin', password_hash: passwordHash, role: 'admin', name: 'Admin', kontak_telegram: null,
    }], {}]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'salah_password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  test('POST /api/auth/login username tidak ada → 401', async () => {
    mockExecute.mockResolvedValueOnce([[], {}]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'tidak_ada', password: 'apapun' });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: JWT Token Validation
// ─────────────────────────────────────────────────────────────────────────────
describe('🔐 JWT Token Validation', () => {
  const protectedRoutes = [
    ['GET',  '/api/devices'],
    ['GET',  '/api/devices/1'],
    ['GET',  '/api/logs'],
    ['GET',  '/api/sensors'],
    ['GET',  '/api/notifications'],
    ['GET',  '/api/actuator/logs'],
    ['GET',  '/api/actuator/emergency/status'],
    ['GET',  '/api/dss/history'],
    ['GET',  '/api/auth/me'],
  ];

  test.each(protectedRoutes)(
    '%s %s tanpa token → 401',
    async (method, route) => {
      const res = await request(app)[method.toLowerCase()](route);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/no token/i);
    }
  );

  test('Token expired → 401 dengan pesan "Token expired"', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', makeExpiredToken('user'));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  test('Token palsu (wrong secret) → 403 Invalid token', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', makeTamperedToken());
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid token/i);
  });

  test('Self-signed admin token → 403 (secret tidak cocok)', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', makeSelfSignedAdminToken());
    expect(res.status).toBe(403);
  });

  test('Authorization header malformed (tidak ada "Bearer ") → 401', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', 'eyJhbGciOiJIUzI1NiJ9.test');
    expect(res.status).toBe(401);
  });

  test('Token dengan karakter tidak valid → 403', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', 'Bearer not.a.valid.jwt!!!');
    expect(res.status).toBe(403);
  });

  test('Token user biasa valid → request diterima (200/500 bukan 401/403)', async () => {
    mockExecute.mockResolvedValueOnce([[], {}]);
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', makeToken('user'));
    expect([200, 500]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3: RBAC — Role-Based Access Control
// ─────────────────────────────────────────────────────────────────────────────
describe('🛡️ RBAC — Admin-Only Endpoints', () => {
  const adminOnlyRoutes = [
    ['POST',   '/api/devices',                    { node_id: 'TEST-01', name: 'Test' }],
    ['PUT',    '/api/devices/1',                  { name: 'Updated' }],
    ['DELETE', '/api/devices/1',                  null],
    ['POST',   '/api/auth/register',              { name: 'x', username: 'x', password: 'x' }],
    ['GET',    '/api/users',                      null],
    ['POST',   '/api/users',                      { name: 'x', username: 'x', password: 'x' }],
    ['PUT',    '/api/users/1',                    { name: 'x', username: 'x' }],
    ['DELETE', '/api/users/1',                    null],
    ['POST',   '/api/actuator/command',           { device_id: 1, aksi: 'AERATOR_ON' }],
    ['POST',   '/api/actuator/emergency/reset/1', null],
    ['GET',    '/api/actuator/notifications/queue', null],
  ];

  test.each(adminOnlyRoutes)(
    'User biasa %s %s → 403',
    async (method, route, body) => {
      let req = request(app)[method.toLowerCase()](route)
        .set('Authorization', makeToken('user'));
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status).toBe(403);
    }
  );

  test('Admin POST /api/devices → diterima (bukan 401/403)', async () => {
    mockExecute.mockResolvedValueOnce([{ insertId: 99, affectedRows: 1 }, {}]);
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', makeToken('admin'))
      .send({ node_id: 'NEW-NODE-99', name: 'Node Baru' });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test('Admin GET /api/users → 200', async () => {
    mockExecute.mockResolvedValueOnce([[
      { id: 1, name: 'Admin', username: 'admin', role: 'admin',
        email: null, kontak_telegram: null, created_at: new Date().toISOString() }
    ], {}]);
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', makeToken('admin'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('users');
  });

  test('Admin tidak bisa hapus akun sendiri (id: 1) → 403', async () => {
    const res = await request(app)
      .delete('/api/users/1')
      .set('Authorization', makeToken('admin', { id: 1 }));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cannot delete your own account/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4: Privilege Escalation Attempts
// ─────────────────────────────────────────────────────────────────────────────
describe('⚠️ Privilege Escalation Attempts', () => {
  test('Modifikasi role dalam payload JWT → 403 (signature invalid)', async () => {
    const rawToken   = makeToken('user').replace('Bearer ', '');
    const parts      = rawToken.split('.');
    const decoded    = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    decoded.role     = 'admin';
    const fakePayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    const tampered   = `Bearer ${parts[0]}.${fakePayload}.fakesig`;

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', tampered);
    expect(res.status).toBe(403);
  });

  test('Token admin self-signed tidak mendapat akses admin endpoint → 403', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', makeSelfSignedAdminToken());
    expect(res.status).toBe(403);
  });

  test('SQL Injection di field username tidak bypass auth → 401', async () => {
    mockExecute.mockResolvedValueOnce([[], {}]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: "admin' OR '1'='1", password: 'apapun' });
    expect(res.status).toBe(401);
  });

  test('Kirim token dengan algoritma "none" → 403', async () => {
    // JWT algorithm none attack: manipulasi header alg
    const header  = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: 1, username: 'admin', role: 'admin' })).toString('base64url');
    const noneToken = `Bearer ${header}.${payload}.`;

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', noneToken);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5: Input Validation & Bad Request Handling
// ─────────────────────────────────────────────────────────────────────────────
describe('📋 Input Validation', () => {
  test('POST /api/actuator/command tanpa aksi → 400', async () => {
    const res = await request(app)
      .post('/api/actuator/command')
      .set('Authorization', makeToken('admin'))
      .send({ device_id: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/actuator/command aksi tidak valid → 400', async () => {
    const res = await request(app)
      .post('/api/actuator/command')
      .set('Authorization', makeToken('admin'))
      .send({ device_id: 1, aksi: 'HACK_THE_SYSTEM' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid aksi/i);
  });

  test('POST /api/auth/register tanpa nama → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', makeToken('admin'))
      .send({ username: 'x', password: 'y' });
    expect(res.status).toBe(400);
  });

  test('POST /api/devices tanpa node_id → 400', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', makeToken('admin'))
      .send({ name: 'Node Tanpa ID' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/node_id/i);
  });

  test('POST /api/users username duplikat → 409', async () => {
    const dupError = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    mockExecute.mockRejectedValueOnce(dupError);
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', makeToken('admin'))
      .send({ name: 'Duplikat', username: 'admin', password: 'pass123', role: 'user' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6: Sensitive Data Exposure
// ─────────────────────────────────────────────────────────────────────────────
describe('🔒 Sensitive Data Exposure', () => {
  test('Response login tidak mengekspos password_hash', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    mockExecute.mockResolvedValueOnce([[{
      id: 1, name: 'Admin', username: 'admin',
      password_hash: passwordHash, role: 'admin', kontak_telegram: null,
    }], {}]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });

  test('GET /api/users tidak mengekspos password_hash', async () => {
    mockExecute.mockResolvedValueOnce([[{
      id: 1, name: 'Admin', username: 'admin',
      role: 'admin', email: null, kontak_telegram: null,
      created_at: new Date().toISOString(),
    }], {}]);
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', makeToken('admin'));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });

  test('GET /api/auth/me tidak mengekspos password_hash', async () => {
    mockExecute.mockResolvedValueOnce([[{
      id: 1, name: 'Admin', username: 'admin',
      role: 'admin', kontak_telegram: null, created_at: new Date().toISOString()
    }], {}]);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', makeToken('user'));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });

  test('Route 404 tidak mengekspos stack trace', async () => {
    const res = await request(app).get('/api/route-tidak-ada');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Error:');
    expect(JSON.stringify(res.body)).not.toContain('at Object.');
  });
});
