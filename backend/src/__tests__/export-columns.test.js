// /api/logs/export?columns= must limit sensor columns (export page checkboxes).
const rows = [{ id: 1, hardware_id: 'N1', device_name: 'Node', suhu: 28, salinitas: 30, turbidity: 5, baterai: 90, rssi: -80, jarak_cm: 30, recorded_at: 't' }];
jest.mock('../config/db', () => ({ getPool: () => ({ execute: async () => [rows], query: async () => [rows] }) }));
jest.mock('../middleware/auth', () => ({ authenticate: (q, r, n) => n(), authorize: () => (q, r, n) => n() }));
const request = require('supertest');
const express = require('express');
const app = express();
app.use('/api/logs', require('../routes/logs.routes'));

test('columns=suhu,rssi keeps only those sensor columns', async () => {
  const res = await request(app).get('/api/logs/export?type=telemetry&columns=suhu,rssi');
  expect(res.text.split('\n')[0]).toBe('ID,Hardware ID,Device Name,Suhu (C),RSSI (dBm),Timestamp');
});
test('no columns param exports all', async () => {
  const res = await request(app).get('/api/logs/export?type=telemetry');
  expect(res.text.split('\n')[0]).toContain('Jarak Air (cm)');
});
