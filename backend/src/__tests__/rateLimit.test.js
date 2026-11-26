jest.mock('../config/db', () => ({ getPool: () => ({ execute: jest.fn() }) }));
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const build = (max) => {
  if (max !== undefined) process.env.RATE_LIMIT_MAX = max;
  let app;
  jest.isolateModules(() => {
    const { apiLimiter } = require('../middleware/rateLimit');
    app = express();
    app.set('trust proxy', 1);
    app.use(require('cookie-parser')());
    app.use('/api', apiLimiter);
    app.get('/api/x', (req, res) => res.json({ ok: true }));
  });
  return app;
};
const tok = (id) => jwt.sign({ id }, process.env.JWT_SECRET || 'bmonitor_dev_secret');
const hit = (app, xff, token) => {
  const r = request(app).get('/api/x').set('X-Forwarded-For', xff);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

afterEach(() => { delete process.env.RATE_LIMIT_MAX; });

test('anonim: bucket per IP via XFF', async () => {
  const app = build('3');
  for (let i = 0; i < 3; i++) expect((await hit(app, '1.1.1.1')).status).toBe(200);
  const r = await hit(app, '1.1.1.1');
  expect(r.status).toBe(429);
  expect(r.body).toEqual({ error: 'Terlalu banyak permintaan.' });
  expect((await hit(app, '2.2.2.2')).status).toBe(200);
});

test('JWT valid: satu bucket lintas IP, user lain tak terpengaruh', async () => {
  const app = build('3');
  const a = tok(10);
  expect((await hit(app, '1.1.1.1', a)).status).toBe(200);
  expect((await hit(app, '2.2.2.2', a)).status).toBe(200);
  expect((await hit(app, '3.3.3.3', a)).status).toBe(200);
  expect((await hit(app, '4.4.4.4', a)).status).toBe(429);
  expect((await hit(app, '1.1.1.1', tok(11))).status).toBe(200);
});

test('token palsu unik tidak dapat bucket sendiri', async () => {
  const app = build('3');
  for (let i = 0; i < 3; i++) expect((await hit(app, '1.1.1.1', `garbage-${i}`)).status).toBe(200);
  expect((await hit(app, '1.1.1.1', 'garbage-3')).status).toBe(429);
  const forged = jwt.sign({ id: 99 }, 'wrong-secret');
  expect((await hit(app, '1.1.1.1', forged)).status).toBe(429);
});

test('RATE_LIMIT_MAX tak valid -> default 300', async () => {
  const app = build('abc');
  const r = await hit(app, '1.1.1.1');
  expect(r.headers['ratelimit-policy']).toMatch(/^300;/);
});
