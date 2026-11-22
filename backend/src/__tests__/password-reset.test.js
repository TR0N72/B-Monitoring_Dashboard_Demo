// Lupa password: kode sekali pakai via Telegram, anti-enumerasi, batas percobaan, kedaluwarsa.
const crypto = require('crypto');
const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
jest.mock('../config/db', () => ({ getPool: () => ({ execute: mockQuery }) }));
const mockSend = jest.fn().mockResolvedValue();
jest.mock('../config/telegramQueue', () => ({ sendToChat: (...a) => mockSend(...a) }));
const { JWT_SECRET } = require('../middleware/auth');

const app = express().use(express.json()).use('/api/auth', require('../routes/auth.routes'));
const hash = (id, code) => crypto.createHmac('sha256', JWT_SECRET).update(`${id}:${code}`).digest('hex');

beforeEach(() => { mockQuery.mockReset(); mockSend.mockClear(); });

test('forgot: user dengan Telegram -> kode disimpan sebagai hash & dikirim; respons generik', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 7, kontak_telegram: '123' }]]).mockResolvedValue([{}]);
  const r = await request(app).post('/api/auth/forgot').send({ username: 'budi' });
  expect(r.status).toBe(200);
  const code = /<code>(\d{6})<\/code>/.exec(mockSend.mock.calls[0][1])[1];
  expect(mockQuery.mock.calls[1][1]).toEqual([7, hash(7, code)]);
  expect(JSON.stringify(mockQuery.mock.calls)).not.toContain(`"${code}"`);
});

test('forgot: username tak dikenal -> respons sama, tidak kirim apa pun', async () => {
  mockQuery.mockResolvedValueOnce([[]]);
  const r = await request(app).post('/api/auth/forgot').send({ username: 'hantu' });
  expect(r.status).toBe(200);
  expect(mockSend).not.toHaveBeenCalled();
});

test('forgot: permintaan kedua untuk username sama dalam 60 detik -> tidak kirim ulang, respons sama', async () => {
  mockQuery.mockResolvedValue([[{ id: 9, kontak_telegram: '456' }]]);
  const a = await request(app).post('/api/auth/forgot').send({ username: 'sari' });
  const b = await request(app).post('/api/auth/forgot').send({ username: 'sari' });
  expect(b.body).toEqual(a.body);
  expect(mockSend).toHaveBeenCalledTimes(1);
});

test('reset: kode benar -> password diganti & kode dihapus', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 7, code_hash: hash(7, '123456'), attempts: 0, valid: 1 }]]).mockResolvedValue([{}]);
  const r = await request(app).post('/api/auth/reset').send({ username: 'budi', code: '123456', password: 'passwordbaru' });
  expect(r.status).toBe(200);
  expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE users SET password_hash/);
  expect(mockQuery.mock.calls[2][0]).toMatch(/DELETE FROM password_resets/);
});

test('reset: kode salah -> 400 + attempts naik; kedaluwarsa / terlalu banyak percobaan -> 400 tanpa update', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 7, code_hash: hash(7, '123456'), attempts: 0, valid: 1 }]]).mockResolvedValue([{}]);
  let r = await request(app).post('/api/auth/reset').send({ username: 'budi', code: '000000', password: 'passwordbaru' });
  expect(r.status).toBe(400);
  expect(mockQuery.mock.calls[1][0]).toMatch(/attempts = attempts \+ 1/);

  for (const row of [{ valid: 0, attempts: 0 }, { valid: 1, attempts: 5 }]) {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce([[{ id: 7, code_hash: hash(7, '123456'), ...row }]]);
    r = await request(app).post('/api/auth/reset').send({ username: 'budi', code: '123456', password: 'passwordbaru' });
    expect(r.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  }
});

test('reset: password pendek -> 400 sebelum menyentuh DB', async () => {
  const r = await request(app).post('/api/auth/reset').send({ username: 'budi', code: '123456', password: 'pendek' });
  expect(r.status).toBe(400);
  expect(mockQuery).not.toHaveBeenCalled();
});
