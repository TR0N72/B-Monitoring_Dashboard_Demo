'use strict';
// Grup 1: akun dihapus/diubah memutus JWT lama; role dari DB; aturan password seragam.
process.env.JWT_SECRET = 'bmonitor_dev_secret';
const mockQuery = jest.fn();
const mockExecute = jest.fn();
jest.mock('../config/db', () => ({ getPool: () => ({ query: mockQuery, execute: mockExecute }) }));

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { invalidate } = require('../services/userGuard');
const { passwordError } = require('../services/passwordPolicy');

const app = express();
app.use(express.json());
app.use('/api/users', require('../routes/users.routes'));
const now = Math.floor(Date.now() / 1000);
const tok = (role = 'admin', iat = now) => `Bearer ${jwt.sign({ id: 7, username: 'a', role, iat }, 'bmonitor_dev_secret', { expiresIn: '1h' })}`;

beforeEach(() => { mockQuery.mockReset(); mockExecute.mockReset(); invalidate(7); });

test('user sudah dihapus dari DB -> 401', async () => {
  mockQuery.mockResolvedValueOnce([[], {}]);
  expect((await request(app).get('/api/users').set('Authorization', tok())).status).toBe(401);
});

test('token terbit sebelum updated_at (password/role diubah) -> 401', async () => {
  mockQuery.mockResolvedValueOnce([[{ role: 'admin', ts: now + 100 }], {}]);
  expect((await request(app).get('/api/users').set('Authorization', tok())).status).toBe(401);
});

test('role diturunkan di DB -> klaim admin di token diabaikan (403)', async () => {
  mockQuery.mockResolvedValueOnce([[{ role: 'user', ts: now - 100 }], {}]);
  expect((await request(app).get('/api/users').set('Authorization', tok('admin'))).status).toBe(403);
});

test('akun valid lolos; hasil di-cache (1 kueri untuk 2 request)', async () => {
  mockQuery.mockResolvedValue([[{ role: 'admin', ts: now - 100 }], {}]);
  mockExecute.mockResolvedValue([[], {}]);
  expect((await request(app).get('/api/users').set('Authorization', tok())).status).toBe(200);
  expect((await request(app).get('/api/users').set('Authorization', tok())).status).toBe(200);
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('DB error saat cek akun -> fail-open pakai klaim token', async () => {
  mockQuery.mockRejectedValueOnce(new Error('db down'));
  mockExecute.mockResolvedValue([[], {}]);
  expect((await request(app).get('/api/users').set('Authorization', tok())).status).toBe(200);
});

test('POST/PUT /api/users menolak password pendek', async () => {
  mockQuery.mockResolvedValue([[{ role: 'admin', ts: now - 100 }], {}]);
  const h = tok();
  let r = await request(app).post('/api/users').set('Authorization', h).send({ name: 'n', username: 'u', password: 'x' });
  expect(r.status).toBe(400);
  r = await request(app).put('/api/users/9').set('Authorization', h).send({ name: 'n', username: 'u', password: 'x' });
  expect(r.status).toBe(400);
});

test('passwordError: <8, >72 byte, bukan string ditolak; normal lolos', () => {
  expect(passwordError('1234567')).toBeTruthy();
  expect(passwordError('a'.repeat(73))).toBeTruthy();
  expect(passwordError(undefined)).toBeTruthy();
  expect(passwordError('12345678')).toBeNull();
});

test('endOfDay: tanggal saja mencakup seluruh hari, timestamp lain dibiarkan', () => {
  const { endOfDay } = require('../services/dateRange');
  expect(endOfDay('2026-11-22')).toBe('2026-11-22 23:59:59');
  expect(endOfDay('2026-11-22 10:00:00')).toBe('2026-11-22 10:00:00');
  expect(endOfDay(undefined)).toBeUndefined();
});
