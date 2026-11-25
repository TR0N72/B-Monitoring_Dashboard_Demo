const express = require('express');
const request = require('supertest');
const { validDate, dateGuard } = require('../services/dateRange');
const { errorHandler } = require('../middleware/errorHandler');

describe('validDate', () => {
  test.each(['2026-11-25', '2026-11-25 10:30:00', '2026-11-25T10:30', '2024-02-29'])('terima %s', (s) => expect(validDate(s)).toBe(true));
  test.each(['garbage', '2026-13-01', '2026-02-30', '2025-02-29', "2026-11-25' OR 1=1", '', 5, ['2026-11-25']])('tolak %p', (s) => expect(validDate(s)).toBe(false));
});

const app = express();
app.use(express.json());
app.use(dateGuard);
app.get('/x', (req, res) => res.json({ ok: true }));
app.use(errorHandler);

describe('dateGuard + errorHandler', () => {
  test('tanggal rusak -> 400', async () => {
    const r = await request(app).get('/x?start_date=garbage');
    expect(r.status).toBe(400);
    expect((await request(app).get('/x?end_date=2026-13-01')).status).toBe(400);
    expect((await request(app).get('/x?start_date[]=2026-11-25')).status).toBe(400);
  });
  test('tanggal sah atau kosong -> lolos', async () => {
    expect((await request(app).get('/x?start_date=2026-11-01&end_date=2026-11-25')).status).toBe(200);
    expect((await request(app).get('/x?start_date=')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(200);
  });
  test('JSON rusak -> 400 Invalid JSON body', async () => {
    const r = await request(app).post('/x').set('content-type', 'application/json').send('{bad');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Invalid JSON body.');
  });
});

describe('seed ambang default (db.js)', () => {
  test('INSERT IGNORE ke threshold_config untuk 3 parameter, tanpa menimpa', async () => {
    jest.resetModules();
    const sqls = [];
    const conn = { execute: async () => [[]], query: async (s) => { sqls.push(String(s)); return [[]]; }, release() {} };
    jest.doMock('mysql2/promise', () => ({ createPool: () => ({ getConnection: async () => conn, end: async () => {} }) }));
    await require('../config/db').initMySQL();
    const seed = sqls.find((s) => /INSERT IGNORE INTO threshold_config/.test(s));
    expect(seed).toBeTruthy();
    ['suhu', 'salinitas', 'turbidity'].forEach((p) => expect(seed).toContain(`'${p}'`));
    expect(seed).not.toMatch(/ON DUPLICATE KEY UPDATE/);
    jest.dontMock('mysql2/promise');
  });
});
