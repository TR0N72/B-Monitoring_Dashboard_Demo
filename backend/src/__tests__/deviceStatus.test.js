const mockExecute = jest.fn();
const mockTelegram = jest.fn();
const mockEmit = jest.fn();
jest.mock('../config/db', () => ({ getPool: () => ({ execute: mockExecute }) }));
jest.mock('../config/telegram', () => ({ sendTelegramAlert: (...a) => mockTelegram(...a) }));
jest.mock('../socket/alerts', () => ({ getIo: () => ({ to: () => ({ emit: mockEmit }) }) }));
const { markStaleOffline } = require('../services/deviceStatus');

const stale = (id, node = `N${id}`) => ({ id, node_id: node, last_seen: new Date(Date.now() - 200000) });
// SELECT -> rows; UPDATE -> affectedRows per `upd`; INSERT -> ok / rejects when insertErr
function wire(rows, { upd = () => 1, insertErr = false } = {}) {
  mockExecute.mockImplementation(async (sql, p) => {
    if (/^SELECT/.test(sql)) return [rows];
    if (/^UPDATE/.test(sql)) return [{ affectedRows: upd(p[0]) }];
    if (insertErr) throw new Error('db down');
    return [{ insertId: 1 }];
  });
}
const calls = (re) => mockExecute.mock.calls.filter((c) => re.test(c[0]));

beforeEach(() => {
  mockExecute.mockReset(); mockTelegram.mockReset().mockResolvedValue(); mockEmit.mockReset();
  delete process.env.DEVICE_OFFLINE_SEC;
});

test('2 device stale -> 2 UPDATE, 2 alert_logs critical, 2 Telegram, 2 socket, return 2', async () => {
  wire([stale(1), stale(2)]);
  expect(await markStaleOffline()).toBe(2);
  expect(calls(/^UPDATE/)).toHaveLength(2);
  const ins = calls(/INSERT INTO alert_logs/);
  expect(ins).toHaveLength(2);
  expect(ins[0][1].slice(0, 2)).toEqual([1, 'device_offline']);
  expect(ins[0][1][5]).toBe('critical');
  expect(mockTelegram).toHaveBeenCalledTimes(2);
  expect(mockTelegram.mock.calls[0][0]).toMatchObject({ device_id: 1, node_id: 'N1', parameter: 'device_offline', level_peringatan: 'critical', threshold_max: 90 });
  expect(mockEmit).toHaveBeenCalledWith('new_alert', expect.objectContaining({ device_id: 2, parameter: 'device_offline' }));
});

test('UPDATE affectedRows=0 (race) -> tanpa INSERT/Telegram untuk device itu', async () => {
  wire([stale(1), stale(2)], { upd: (id) => (id === 1 ? 0 : 1) });
  expect(await markStaleOffline()).toBe(1);
  expect(calls(/INSERT INTO alert_logs/)).toHaveLength(1);
  expect(mockTelegram).toHaveBeenCalledTimes(1);
  expect(mockTelegram.mock.calls[0][0].device_id).toBe(2);
});

test('INSERT alert_logs gagal -> Telegram tetap, device lain tetap diproses, resolve', async () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  wire([stale(1), stale(2)], { insertErr: true });
  expect(await markStaleOffline()).toBe(2);
  expect(mockTelegram).toHaveBeenCalledTimes(2);
  err.mockRestore();
});

test('Telegram throw tidak menghentikan socket/device lain', async () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockTelegram.mockRejectedValue(new Error('tg'));
  wire([stale(1), stale(2)]);
  expect(await markStaleOffline()).toBe(2);
  expect(mockEmit).toHaveBeenCalledTimes(2);
  err.mockRestore();
});

test('hanya status online dipilih/diubah; maintenance aman', async () => {
  wire([]);
  expect(await markStaleOffline()).toBe(0);
  expect(mockExecute.mock.calls[0][0]).toMatch(/WHERE status = 'online'/);
  wire([stale(1)]);
  await markStaleOffline();
  expect(calls(/^UPDATE/)[0][0]).toMatch(/status = 'online'/);
});

test('DEVICE_OFFLINE_SEC dipakai; nilai tak valid kembali ke 90', async () => {
  wire([]);
  process.env.DEVICE_OFFLINE_SEC = '30';
  await markStaleOffline();
  process.env.DEVICE_OFFLINE_SEC = 'abc';
  await markStaleOffline();
  expect(mockExecute.mock.calls.map((c) => c[1][0])).toEqual([30, 90]);
});

test('last_seen NULL -> measured_value = sweepSec', async () => {
  wire([{ id: 5, node_id: 'N5', last_seen: null }]);
  await markStaleOffline();
  expect(calls(/INSERT INTO alert_logs/)[0][1][2]).toBe(90);
});
