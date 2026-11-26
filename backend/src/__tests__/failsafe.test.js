'use strict';
// Failsafe getaran (emergencyState) + rantai aktuator (actuatorController). DB, Telegram, MQTT dipalsukan.
process.env.FAILSAFE_VERIFY_WINDOW_MS = '20';
process.env.ACTUATOR_STEP_DELAY_MS = '10';

const mockExecute = jest.fn();
const mockTq = { sendDssAlert: jest.fn(), sendEmergency: jest.fn() };
jest.mock('../config/db', () => ({ getPool: () => ({ execute: mockExecute }) }));
jest.mock('../config/telegramQueue', () => mockTq);

let es, ac, t0, nowSpy;
const mqtt = () => ({ connected: true, publish: jest.fn() });
const io = () => ({ emit: jest.fn() });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  jest.resetModules();
  mockExecute.mockReset().mockResolvedValue([{ insertId: 5 }]);
  mockTq.sendDssAlert.mockReset(); mockTq.sendEmergency.mockReset();
  es = require('../services/emergencyState');
  ac = require('../services/actuatorController');
  t0 = 1_000_000;
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

const vib = (extra, at) => { nowSpy.mockReturnValue(t0 + at); return es.handleVibrationData({ deviceId: 1, nodeId: 'P1', payload: extra, ...vib.ctx }); };

describe('emergencyState', () => {
  beforeEach(() => { vib.ctx = { io: io(), mqttClient: mqtt() }; es.markEngineStopSent(1, 99); mockExecute.mockClear(); });

  test('masih bergetar setelah jendela verifikasi -> emergency, EMERGENCY_STOP qos2, WS, Telegram, alert_logs', async () => {
    await vib({ vibration: true }, 25);
    expect(es.isEmergencyActive(1)).toBe(true);
    const pub = vib.ctx.mqttClient.publish.mock.calls[0];
    expect(pub[0]).toBe('tambak/P1/actuator/command');
    expect(JSON.parse(pub[1]).aksi).toBe('EMERGENCY_STOP');
    expect(pub[2]).toEqual({ qos: 2 });
    expect(vib.ctx.io.emit).toHaveBeenCalledWith('system:emergency', expect.objectContaining({ risk: 'OVERFILLING' }));
    expect(mockTq.sendEmergency).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls.some(([sql]) => /INSERT INTO alert_logs/.test(sql))).toBe(true);
  });

  test('bergetar tapi jendela belum habis -> belum emergency', async () => {
    await vib({ vibration: true }, 5);
    expect(es.isEmergencyActive(1)).toBe(false);
    expect(mockTq.sendEmergency).not.toHaveBeenCalled();
  });

  test('intensitas >= ambang dihitung bergetar; di bawah ambang tidak', async () => {
    await vib({ intensity: 0.1 }, 25);
    expect(es.isEmergencyActive(1)).toBe(false);
    nowSpy.mockReturnValue(t0);
    es.markEngineStopSent(1, 99);
    await vib({ intensity: 0.5 }, 25);
    expect(es.isEmergencyActive(1)).toBe(true);
  });

  test('berhenti >= 2 dtk -> terkonfirmasi, log executed, tanpa emergency', async () => {
    await vib({ vibration: false }, 2500);
    expect(es.isEmergencyActive(1)).toBe(false);
    expect(mockExecute.mock.calls.find(([sql]) => /UPDATE actuator_logs/.test(sql))[1][0]).toBe('executed');
    expect(vib.ctx.io.emit).toHaveBeenCalledWith('actuator:confirmed', expect.any(Object));
  });

  test('berhenti < 2 dtk -> belum dikonfirmasi', async () => {
    await vib({ vibration: false }, 500);
    expect(mockExecute.mock.calls.filter(([sql]) => /actuator_logs/.test(sql))).toHaveLength(0);
  });

  test('reset ditolak bila baru bergetar (<5 dtk); force dan mesin-berhenti lolos', async () => {
    await vib({ vibration: true }, 25);
    expect(() => es.resetEmergencyState(1)).toThrow(/masih terdeteksi bergetar/);
    es.resetEmergencyState(1, true);
    expect(es.isEmergencyActive(1)).toBe(false);
    es.markEngineStopSent(1, 99);
    await vib({ vibration: true }, 30); await vib({ vibration: false }, 31);
    expect(() => es.resetEmergencyState(1)).not.toThrow();
  });
});

describe('actuatorController.evaluateAndActuate', () => {
  const run = (score, nodeId = 'P1', deviceId = 1) => {
    const m = mqtt();
    return ac.evaluateAndActuate({ mqttClient: m, deviceId, nodeId, fuzzyResult: { score, recommendation: 'x' }, readings: { suhu: 30, salinitas: 20 }, io: io() }).then(() => m);
  };
  const aksi = (m) => m.publish.mock.calls.map(([, p]) => JSON.parse(p).aksi);

  test('skor < 36 (aman): tidak ada aksi', async () => {
    const m = await run(10);
    expect(m.publish).not.toHaveBeenCalled();
    expect(mockTq.sendDssAlert).not.toHaveBeenCalled();
  });

  test('waspada: notifikasi saja, dan cooldown mencegah dobel', async () => {
    const m = await run(50); await run(50);
    expect(m.publish).not.toHaveBeenCalled();
    expect(mockTq.sendDssAlert).toHaveBeenCalledTimes(1);
    expect(mockTq.sendDssAlert.mock.calls[0][0].level).toBe('waspada');
  });

  test('bahaya di node chamber (N1): notifikasi saja, tanpa aktuator', async () => {
    const m = await run(80, 'N1');
    expect(m.publish).not.toHaveBeenCalled();
    expect(mockTq.sendDssAlert.mock.calls[0][0].level).toBe('bahaya');
  });

  test('bahaya di node kolam: PUMP_ENGINE_STOP dulu, lalu kuras -> tutup -> isi -> tutup', async () => {
    jest.useFakeTimers({ doNotFake: ['Date'] }); // jeda transisi 5 dtk hardcoded di controller
    const m = await run(80);
    await jest.advanceTimersByTimeAsync(6000);
    jest.useRealTimers();
    expect(aksi(m)).toEqual(['PUMP_ENGINE_STOP', 'OPEN_DRAIN_VALVE', 'CLOSE_DRAIN_VALVE', 'OPEN_FILL_VALVE', 'CLOSE_FILL_VALVE']);
  });

  test('bahaya saat emergency aktif: rantai diblokir', async () => {
    es.markEngineStopSent(1, 1);
    nowSpy.mockReturnValue(t0 + 25);
    await es.handleVibrationData({ deviceId: 1, nodeId: 'P1', payload: { vibration: true }, io: io(), mqttClient: mqtt() });
    mockTq.sendDssAlert.mockReset();
    const m = await run(80);
    await sleep(60);
    expect(m.publish).not.toHaveBeenCalled();
  });

  test('bahaya kedua dalam cooldown dilewati', async () => {
    await run(80); ac.abortSequence(1);
    const m2 = await run(80); await sleep(60);
    expect(m2.publish).not.toHaveBeenCalled();
  });

  test('abortSequence menghentikan langkah berikutnya', async () => {
    const m = await run(80);
    ac.abortSequence(1);
    await sleep(100);
    expect(aksi(m)).toEqual(['PUMP_ENGINE_STOP']);
  });
});
