'use strict';
process.env.JWT_SECRET = 'bmonitor_dev_secret';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
const mockExecute = jest.fn();
jest.mock('../config/db', () => ({ getPool: jest.fn(() => ({ execute: mockExecute, query: jest.fn() })) }));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

beforeEach(() => { mockExecute.mockReset(); mockExecute.mockResolvedValue([[], {}]); });

describe('#15 token blacklist', () => {
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.use('/api/auth', require('../routes/auth.routes'));
  app.use('/api/sensors', require('../routes/sensors.routes'));
  const mk = () => jwt.sign({ id: 1, username: 'u', role: 'user' }, 'bmonitor_dev_secret', { expiresIn: '1h', jwtid: require('crypto').randomUUID() });

  test('token valid sebelum logout, ditolak 401 sesudahnya, dan dipersist ke DB', async () => {
    const token = mk();
    const h = { Authorization: `Bearer ${token}` };
    expect((await request(app).get('/api/sensors/stats?range=bogus').set(h)).status).toBe(400); // lolos auth
    expect((await request(app).post('/api/auth/logout').set(h)).status).toBe(200);
    const r = await request(app).get('/api/sensors/stats?range=24h').set(h);
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/revoked/i);
    expect(mockExecute.mock.calls.some(([sql]) => /INSERT IGNORE INTO revoked_tokens/.test(sql))).toBe(true);
  });

  test('logout token sampah tidak masuk blacklist', async () => {
    await request(app).post('/api/auth/logout').set({ Authorization: 'Bearer abc.def.ghi' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test('token lain tetap valid', async () => {
    const r = await request(app).get('/api/sensors/stats?range=bogus').set({ Authorization: `Bearer ${mk()}` });
    expect(r.status).toBe(400);
  });
});

describe('#12/#13 telegramQueue persisten + cooldown tunggal', () => {
  let tq;
  beforeAll(() => { tq = jest.requireActual('../config/telegramQueue'); });

  test('enqueue menulis ke telegram_queue; cooldown menahan duplikat', () => {
    tq.enqueue({ priority: tq.PRIORITY.WARNING, deviceId: 7, alertData: { parameter: 'suhu', measured_value: 40 } });
    tq.enqueue({ priority: tq.PRIORITY.WARNING, deviceId: 7, alertData: { parameter: 'suhu', measured_value: 41 } });
    const inserts = mockExecute.mock.calls.filter(([sql]) => /INSERT IGNORE INTO telegram_queue/.test(sql));
    expect(inserts).toHaveLength(1); // duplikat ditahan cooldown 5 menit
    expect(JSON.parse(inserts[0][1][3])).toMatchObject({ parameter: 'suhu', measured_value: 40 });
  });

  test('loadPersisted memulihkan item pending ke memori', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'tq-old-1', priority: 3, device_id: 9,
      alert_data: JSON.stringify({ parameter: 'x' }), retry_count: 2, next_attempt_at: 0, created_at: 1 }]]);
    expect(await tq.loadPersisted()).toBe(1);
    expect(tq.getQueueStatus().total).toBeGreaterThanOrEqual(1);
  });

  test('mqtt.js tidak lagi punya debounce sendiri', () => {
    expect(require('fs').readFileSync(require.resolve('../config/mqtt'), 'utf8')).not.toMatch(/alertDebounce|ALERT_DEBOUNCE_MS/);
  });
});

describe('#9 /api/sensors/stats', () => {
  const app = express();
  app.use('/api/sensors', require('../routes/sensors.routes'));
  const h = { Authorization: `Bearer ${jwt.sign({ id: 1, role: 'user' }, 'bmonitor_dev_secret')}` };

  test('menghitung avg/min/max/tren dan ringkasan node', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ samples: 10,
        suhu_avg: 28.5, suhu_min: 26, suhu_max: 31, suhu_n: 10, suhu_old: 27, suhu_new: 30,
        jarak_cm_avg: 20, jarak_cm_min: 18, jarak_cm_max: 22, jarak_cm_n: 10, jarak_cm_old: 20, jarak_cm_new: 20,
        salinitas_avg: null, salinitas_min: null, salinitas_max: null, salinitas_n: 0, salinitas_old: null, salinitas_new: null,
        turbidity_avg: 5, turbidity_min: 1, turbidity_max: 9, turbidity_n: 10, turbidity_old: 6, turbidity_new: 4 }]])
      .mockResolvedValueOnce([[{ node_id: 'N1', name: 'Node 1', status: 'online', samples: 10, suhu: 28.5, jarak_cm: 20, salinitas: null, turbidity: 5 }]]);
    const r = await request(app).get('/api/sensors/stats?range=7d').set(h);
    expect(r.status).toBe(200);
    expect(r.body.samples).toBe(10);
    expect(r.body.metrics.suhu).toMatchObject({ avg: 28.5, min: 26, max: 31, trend: 'up' });
    expect(r.body.metrics.jarak_cm.trend).toBe('stable');
    expect(r.body.metrics.turbidity.trend).toBe('down');
    expect(r.body.metrics.salinitas.avg).toBeNull();
    expect(r.body.nodes[0]).toMatchObject({ node_id: 'N1', online: true, suhu: 28.5 });
  });

  test('range tidak valid -> 400; DB error -> 500', async () => {
    expect((await request(app).get('/api/sensors/stats?range=1y').set(h)).status).toBe(400);
    mockExecute.mockRejectedValue(new Error('down'));
    expect((await request(app).get('/api/sensors/stats').set(h)).status).toBe(500);
  });
});
