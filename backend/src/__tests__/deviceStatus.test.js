const mockExecute = jest.fn();
jest.mock('../config/db', () => ({ getPool: () => ({ execute: mockExecute }) }));
const { markStaleOffline } = require('../services/deviceStatus');

beforeEach(() => { mockExecute.mockReset(); delete process.env.DEVICE_OFFLINE_SEC; });

test('default 90 dtk, hanya ubah online -> offline, maintenance aman', async () => {
  mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
  expect(await markStaleOffline()).toBe(1);
  const [sql, vals] = mockExecute.mock.calls[0];
  expect(sql).toMatch(/WHERE status = 'online'/);
  expect(vals).toEqual([90]);
});

test('DEVICE_OFFLINE_SEC dipakai; nilai tak valid kembali ke 90', async () => {
  mockExecute.mockResolvedValue([{ affectedRows: 0 }]);
  process.env.DEVICE_OFFLINE_SEC = '30';
  await markStaleOffline();
  process.env.DEVICE_OFFLINE_SEC = 'abc';
  await markStaleOffline();
  expect(mockExecute.mock.calls.map((c) => c[1][0])).toEqual([30, 90]);
});
