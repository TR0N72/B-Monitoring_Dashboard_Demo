'use strict';
// #7: state failsafe dipersist ke emergency_state & dipulihkan saat startup.
process.env.FAILSAFE_VERIFY_WINDOW_MS = '20';

const mockExecute = jest.fn();
jest.mock('../config/db', () => ({ getPool: () => ({ execute: mockExecute }) }));
jest.mock('../config/telegramQueue', () => ({ sendDssAlert: jest.fn(), sendEmergency: jest.fn() }));

let es;
const upserts = () => mockExecute.mock.calls.filter(([sql]) => /INSERT INTO emergency_state.*ON DUPLICATE KEY UPDATE/s.test(sql));
const last = () => upserts().at(-1)[1]; // [device, active, activatedAt, pending, sentAt, cmdId, notifiedAt]
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.resetModules();
  mockExecute.mockReset().mockResolvedValue([{ insertId: 1 }]);
  es = require('../services/emergencyState');
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('markEngineStopSent -> upsert pending=1, command id 99', () => {
  es.markEngineStopSent(1, 99);
  const p = last();
  expect(p[0]).toBe(1);
  expect(p[3]).toBe(1);
  expect(p[5]).toBe(99);
});

test('aktivasi emergency -> persisted emergency_active=1', async () => {
  es.markEngineStopSent(1, 99);
  await new Promise((r) => setTimeout(r, 25));
  await es.handleVibrationData({ deviceId: 1, nodeId: 'P1', payload: { vibration: true }, io: { emit: jest.fn() }, mqttClient: null });
  expect(es.isEmergencyActive(1)).toBe(true);
  const p = last();
  expect(p[1]).toBe(1);
  expect(p[2]).toEqual(expect.any(Number));
  expect(p[6]).toEqual(expect.any(Number));
});

test('konfirmasi mesin berhenti -> persisted pending=0', async () => {
  es.markEngineStopSent(1, 99);
  const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 3000);
  await es.handleVibrationData({ deviceId: 1, nodeId: 'P1', payload: { vibration: false } });
  spy.mockRestore();
  expect(last()[3]).toBe(0);
});

test('resetEmergencyState(force) -> active 0, pending 0, null', () => {
  es.markEngineStopSent(1, 99);
  es.resetEmergencyState(1, true);
  expect(last()).toEqual([1, 0, null, 0, null, null, null]);
});

test('loadEmergencyStates memulihkan state (BIGINT string -> number)', async () => {
  mockExecute.mockResolvedValueOnce([[{
    device_id: 1, emergency_active: 1, emergency_activated_at: '1700000000000',
    engine_stop_pending: 0, engine_stop_sent_at: null, engine_stop_command_id: null, last_notified_at: '1700000000000',
  }]]);
  expect(await es.loadEmergencyStates()).toBe(1);
  expect(mockExecute.mock.calls[0][0]).toMatch(/FROM emergency_state WHERE emergency_active = 1 OR engine_stop_pending = 1/);
  expect(es.isEmergencyActive(1)).toBe(true);
  expect(es.getAllEmergencyStates()[0].emergency_activated_at).toBe(new Date(1700000000000).toISOString());
});

test('persist gagal -> state in-memory tetap berubah, log persist FAILED, tidak throw', async () => {
  mockExecute.mockRejectedValue(new Error('db down'));
  expect(() => es.markEngineStopSent(1, 99)).not.toThrow();
  await flush();
  expect(es.getDeviceState(1).engineStopPending).toBe(true);
  expect(console.error.mock.calls.flat().join(' ')).toContain('persist FAILED');
});

test('persist: pool tidak ada -> diam, tidak throw', () => {
  jest.resetModules();
  jest.doMock('../config/db', () => ({ getPool: () => { throw new Error('no pool'); } }));
  const es2 = require('../services/emergencyState');
  expect(() => es2.markEngineStopSent(1, 5)).not.toThrow();
  expect(es2.getDeviceState(1).engineStopPending).toBe(true);
  jest.dontMock('../config/db');
  jest.resetModules();
  jest.doMock('../config/db', () => ({ getPool: () => ({ execute: mockExecute }) }));
});

test('load gagal -> loadEmergencyStates reject', async () => {
  mockExecute.mockRejectedValueOnce(new Error('boom'));
  await expect(es.loadEmergencyStates()).rejects.toThrow('boom');
});
