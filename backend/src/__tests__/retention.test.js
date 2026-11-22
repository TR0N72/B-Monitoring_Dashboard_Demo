// Retention: roll-up selalu jalan; DELETE hanya bila SENSOR_RETENTION_DAYS diset, dan hanya baris yang sudah di-roll-up.
const { rollup, purge, runRetention } = require('../services/retention');
const mk = (affected = []) => { const q = jest.fn(); affected.forEach((a) => q.mockResolvedValueOnce([{ affectedRows: a }])); q.mockResolvedValue([{ affectedRows: 0 }]); return { query: q }; };
afterEach(() => { delete process.env.SENSOR_RETENTION_DAYS; });

test('rollup: upsert idempotent, hanya jam penuh', async () => {
  const p = mk([3]);
  expect(await rollup(p)).toBe(3);
  const sql = p.query.mock.calls[0][0];
  expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/);
  expect(sql).toMatch(/recorded_at < DATE_FORMAT\(NOW\(\)/);
});
test('purge mati secara default: tidak ada DELETE', async () => {
  const p = mk();
  expect(await purge(p)).toBe(0);
  expect(p.query).not.toHaveBeenCalled();
});
test('purge aktif: hapus per 10k sampai habis, hanya data yang sudah di-roll-up', async () => {
  process.env.SENSOR_RETENTION_DAYS = '30';
  const p = mk([10000, 10000, 42]);
  expect(await purge(p)).toBe(20042);
  expect(p.query).toHaveBeenCalledTimes(3);
  const [sql, args] = p.query.mock.calls[0];
  expect(sql).toMatch(/MAX\(hour_start\) FROM sensor_hourly/);
  expect(args).toEqual([30]);
});
test('runRetention: roll-up dulu, baru purge', async () => {
  process.env.SENSOR_RETENTION_DAYS = '7';
  const p = mk([5, 2]);
  expect(await runRetention(p)).toEqual({ rolled: 5, purged: 2 });
  expect(p.query.mock.calls[0][0]).toMatch(/INSERT INTO sensor_hourly/);
  expect(p.query.mock.calls[1][0]).toMatch(/DELETE FROM sensor_data/);
});
