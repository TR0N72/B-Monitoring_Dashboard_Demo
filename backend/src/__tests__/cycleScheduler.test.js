const mockQuery = jest.fn();
jest.mock('../config/db', () => ({ getPool: () => ({ execute: mockQuery }) }));
jest.mock('../config/mqtt', () => ({ publishMQTT: jest.fn() }));
jest.mock('../services/emergencyState', () => ({ isEmergencyActive: jest.fn(() => false) }));
const { publishMQTT } = require('../config/mqtt');
const { isEmergencyActive } = require('../services/emergencyState');
const { tick } = require('../services/cycleScheduler');

const run = (rows) => { mockQuery.mockReset(); rows.forEach((r) => mockQuery.mockResolvedValueOnce([r])); publishMQTT.mockClear(); return tick(['N1']); };

test('kirim START_CYCLE bila IDLE dan tidak ada pending', async () => {
  expect(await run([[{ id: 4 }], [{ siklus_status: 'IDLE', fresh: 1 }], [], { insertId: 77 }])).toEqual(['N1']);
  expect(publishMQTT).toHaveBeenCalledWith('tambak/N1/actuator/command', { aksi: 'START_CYCLE', cmd: 'c', command_id: 77 }, { qos: 1 });
});
test('skip bila siklus sedang MEASURE', async () => {
  expect(await run([[{ id: 4 }], [{ siklus_status: 'MEASURE', fresh: 1 }]])).toEqual([]);
});
test('skip bila START_CYCLE sebelumnya pending', async () => {
  expect(await run([[{ id: 4 }], [{ siklus_status: 'IDLE', fresh: 1 }], [{ id: 5 }]])).toEqual([]);
});
test('skip bila emergency aktif', async () => {
  isEmergencyActive.mockReturnValueOnce(true);
  expect(await run([[{ id: 4 }]])).toEqual([]);
});
test('skip bila node tidak terdaftar', async () => {
  expect(await run([[]])).toEqual([]);
});
