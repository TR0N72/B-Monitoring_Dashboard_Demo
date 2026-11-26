// /api/logs/export streams rows via mysql2 cursor (connection.query().stream()); ?columns= limits sensor columns.
const { Readable } = require('stream');
const rows = [{ id: 1, hardware_id: 'N1', device_name: 'No"de', suhu: 28, salinitas: 30, turbidity: 5, baterai: 90, rssi: -80, jarak_cm: 30, recorded_at: 't' }];
const mockConn = { connection: { query: jest.fn() }, release: jest.fn(), destroy: jest.fn() };
const mockPool = { getConnection: jest.fn(async () => mockConn), execute: jest.fn() };
jest.mock('../config/db', () => ({ getPool: () => mockPool }));
jest.mock('../middleware/auth', () => ({ authenticate: (q, r, n) => n(), authorize: () => (q, r, n) => n() }));
const request = require('supertest');
const express = require('express');
const app = express();
app.use('/api/logs', require('../routes/logs.routes'));

const useRows = (list, failAt) => mockConn.connection.query.mockImplementation(() => ({
  stream: () => Readable.from((async function* () { for (const [i, r] of list.entries()) { if (i === failAt) throw new Error('boom'); yield r; } })()),
}));
beforeEach(() => { jest.clearAllMocks(); useRows(rows); });

test('columns=suhu,rssi keeps only those sensor columns', async () => {
  const res = await request(app).get('/api/logs/export?type=telemetry&columns=suhu,rssi');
  expect(res.text.split('\n')[0]).toBe('ID,Hardware ID,Device Name,Suhu (C),RSSI (dBm),Timestamp');
});
test('no columns param exports all, quotes escaped, never uses pool.execute (no full-RAM load)', async () => {
  const res = await request(app).get('/api/logs/export?type=telemetry');
  expect(res.headers['content-type']).toMatch(/text\/csv/);
  const [head, line] = res.text.split('\n');
  expect(head).toContain('Jarak Air (cm)');
  expect(line).toContain('"No""de"');
  expect(mockPool.execute).not.toHaveBeenCalled();
  expect(mockConn.release).toHaveBeenCalledTimes(1);
});
test('streams 20k rows with all lines intact', async () => {
  useRows(Array.from({ length: 20000 }, (_, i) => ({ ...rows[0], id: i + 1 })));
  const res = await request(app).get('/api/logs/export?type=telemetry').buffer(true).parse((r, cb) => { let n = 0, last = ''; r.on('data', (d) => { const s = last + d.toString(); const p = s.split('\n'); last = p.pop(); n += p.length; }); r.on('end', () => cb(null, n)); });
  expect(res.body).toBe(20001); // header + 20000 rows
});
test('alert type streams too', async () => {
  useRows([{ id: 1, hardware_id: 'N1', device_name: 'n', parameter: 'suhu', measured_value: 40, level_peringatan: 'BAHAYA', pesan_notifikasi: 'x', acknowledged: 0, created_at: 't' }]);
  const res = await request(app).get('/api/logs/export?type=alerts');
  expect(res.text.split('\n')[0]).toContain('Acknowledged');
  expect(res.text).toContain(',No,t');
});
test('stream error: connection destroyed, not returned to pool', async () => {
  useRows([rows[0], rows[0], rows[0]], 1);
  await request(app).get('/api/logs/export?type=telemetry').catch(() => {});
  expect(mockConn.destroy).toHaveBeenCalled();
  expect(mockConn.release).not.toHaveBeenCalled();
});
test('pool.getConnection failure -> 500 json', async () => {
  mockPool.getConnection.mockRejectedValueOnce(new Error('down'));
  const res = await request(app).get('/api/logs/export?type=telemetry');
  expect(res.status).toBe(500);
});
