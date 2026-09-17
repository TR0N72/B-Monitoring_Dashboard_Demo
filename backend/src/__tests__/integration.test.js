'use strict';
/**
 * End-to-End Integration Testing — B-Monitor API
 * ==============================================
 * Menguji integrasi alur sistem dari hulu ke hilir:
 *
 * Skenario 1: Admin meregistrasikan perangkat IoT baru dan mengatur Threshold (Auth -> Devices -> Thresholds)
 * Skenario 2: Simulasi data Sensor yang memicu logika Fuzzy DSS (Sensors -> DSS)
 * Skenario 3: Sensor melewati batas, memicu Notifikasi, lalu Admin merespon via Aktuator (Sensors -> Notifications -> Actuator)
 *
 * Catatan: Menggunakan In-Memory Mock Database agar bisa mensimulasikan state.
 */

const JWT_SECRET = 'bmonitor_dev_secret';
process.env.JWT_SECRET = JWT_SECRET;

// ── In-Memory State untuk Mock DB ────────────────────────────────────────────
let mockDevices = [];
let mockThresholds = [];
let mockLogs = [];
let mockActuatorLogs = [];
let nextDeviceId = 1;
let nextLogId = 1;
let nextActuatorLogId = 1;

// ── Custom Mock untuk pool.execute ───────────────────────────────────────────
const mockExecute = jest.fn(async (query, params) => {
  const sql = query.trim().toUpperCase().replace(/\s+/g, ' ');

  // AUTH (Selalu kembalikan 1 user admin dan 1 user biasa jika diminta)
  if (sql.startsWith('SELECT * FROM USERS WHERE USERNAME =')) {
    if (params[0] === 'admin') return [[{ id: 1, username: 'admin', password_hash: '$2a$10$abcdefghijklmnopqrstuuVmGKkZm7y6m7h4g1RFDUyYDM9wl8Ni', role: 'admin' }], {}];
    if (params[0] === 'user') return [[{ id: 2, username: 'user', password_hash: '$2a$10$abcdefghijklmnopqrstuuVmGKkZm7y6m7h4g1RFDUyYDM9wl8Ni', role: 'user' }], {}];
    return [[], {}];
  }

  // DEVICES
  if (sql.startsWith('SELECT * FROM DEVICES') || sql.includes('FROM DEVICES WHERE NODE_ID =') || sql.includes('FROM DEVICES WHERE ID =') || sql.includes('FROM DEVICES WHERE DEVICE_ID =')) {
    if (sql.includes('WHERE NODE_ID =') || sql.includes('WHERE ID =') || sql.includes('WHERE DEVICE_ID =')) {
      const dev = mockDevices.find(d => d.node_id === params[0] || d.id === Number(params[0]));
      return [dev ? [dev] : [], {}];
    }
    return [mockDevices, {}];
  }
  if (sql.startsWith('INSERT INTO DEVICES')) {
    const newDev = { id: nextDeviceId++, node_id: params[0], name: params[1], type: params[2], status: 'online' };
    mockDevices.push(newDev);
    return [{ insertId: newDev.id }, {}];
  }
  if (sql.startsWith('UPDATE DEVICES')) {
    const dev = mockDevices.find(d => d.id === params[2]); // params: [name, lokasi, id]
    if (dev) { dev.name = params[0]; dev.lokasi = params[1]; }
    return [{ affectedRows: 1 }, {}];
  }

  // THRESHOLDS
  if (sql.startsWith('SELECT TC.ID, TC.PARAMETER')) {
    return [mockThresholds, {}];
  }
  if (sql.startsWith('SELECT PARAMETER, BATAS_BAWAH, BATAS_ATAS FROM THRESHOLD_CONFIG WHERE DEVICE_ID =') || sql.startsWith('SELECT TC.ID, TC.PARAMETER, TC.BATAS_BAWAH')) {
    const res = mockThresholds.filter(t => t.device_id === Number(params[0]));
    return [res, {}];
  }
  if (sql.startsWith('DELETE FROM THRESHOLD_CONFIG WHERE DEVICE_ID =')) {
    mockThresholds = mockThresholds.filter(t => t.device_id !== Number(params[0]));
    return [{ affectedRows: 1 }, {}];
  }
  if (sql.startsWith('INSERT INTO THRESHOLD_CONFIG')) {
    // device_id, user_id, parameter, batas_bawah, batas_atas
    const newT = { device_id: params[0], user_id: params[1], parameter: params[2], batas_bawah: params[3], batas_atas: params[4] };
    mockThresholds.push(newT);
    return [{ insertId: 999 }, {}];
  }

  // LOGS (Alerts)
  if (sql.startsWith('INSERT INTO ALERT_LOGS')) {
    const newLog = { id: nextLogId++, device_id: params[0], parameter: params[1], measured_value: params[2], level_peringatan: params[5], pesan_notifikasi: params[6] };
    mockLogs.push(newLog);
    return [{ insertId: newLog.id }, {}];
  }
  if (sql.startsWith('SELECT COUNT(*) AS TOTAL FROM ALERT_LOGS')) {
    return [[{ total: mockLogs.length }], {}];
  }
  if (sql.includes('FROM ALERT_LOGS')) {
    return [mockLogs, {}];
  }

  // ACTUATOR
  if (sql.startsWith('INSERT INTO ACTUATOR_LOGS')) {
    const act = { id: nextActuatorLogId++, device_id: params[0], aksi: params[1], trigger_source: params[2], status: 'pending' };
    mockActuatorLogs.push(act);
    return [{ insertId: act.id }, {}];
  }
  if (sql.includes('FROM ACTUATOR_LOGS')) {
    const logs = mockActuatorLogs.filter(a => a.device_id === Number(params[0]));
    return [logs, {}];
  }

  // TRANSACTION CONTROL
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return [{}, {}];

  // Default fallback for SELECT statements to return empty instead of breaking destructuring
  if (sql.startsWith('SELECT')) return [[], {}];
  
  console.log('[MOCK DB UNHANDLED]', sql);
  return [[], {}];
});

const mockPool = { execute: mockExecute, getConnection: jest.fn(() => ({ execute: mockExecute, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() })) };

jest.mock('../config/db', () => ({
  getPool: jest.fn(() => mockPool),
  initMySQL: jest.fn().mockResolvedValue(undefined),
  closeMySQL: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../config/mqtt', () => ({ initMQTT: jest.fn(), closeMQTT: jest.fn(), publishMQTT: jest.fn(), getMQTTClient: jest.fn(() => ({})) }));
jest.mock('../config/telegram', () => ({
  verifyBot: jest.fn(),
  sendTelegramMessage: jest.fn().mockResolvedValue(true),
  sendTelegramAlert: jest.fn().mockResolvedValue(true)
}));
jest.mock('../socket/alerts', () => ({
  initSocket: jest.fn(),
  broadcastAlert: jest.fn()
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const express = require('express');

// Build Express app manually because server.js doesn't export app
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth.routes'));
app.use('/api/devices', require('../routes/devices.routes'));
app.use('/api/config/thresholds', require('../routes/thresholds.routes'));
app.use('/api/logs', require('../routes/logs.routes'));
app.use('/api/sensors', require('../routes/sensors.routes'));
app.use('/api/notifications', require('../routes/notifications.routes'));
app.use('/api/actuator', require('../routes/actuator.routes'));
app.use('/api/dss', require('../routes/fuzzy.routes'));
app.use('/api/users', require('../routes/users.routes'));



// Helper Token
const adminToken = 'Bearer ' + jwt.sign({ id: 1, username: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const userToken  = 'Bearer ' + jwt.sign({ id: 2, username: 'user', role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });

describe('🔗 E2E Integration Testing: B-Monitor (Mocked DB State)', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    // Reset state but keep initial structure empty
    mockDevices = [];
    mockThresholds = [];
    mockLogs = [];
    mockActuatorLogs = [];
    nextDeviceId = 1;
    nextLogId = 1;
    nextActuatorLogId = 1;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SKENARIO 1: Setup Perangkat & Threshold
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Skenario 1: Setup Node dan Batas Aman', () => {
    test('1.1 Admin dapat mendaftarkan perangkat baru', async () => {
      const res = await request(app)
        .post('/api/devices')
        .set('Authorization', adminToken)
        .send({ node_id: 'INTEGRATION-NODE-01', name: 'Node Tambak Utama', type: 'sensor_node' });
      
      expect(res.status).toBe(201);
      expect(res.body.device.node_id).toBe('INTEGRATION-NODE-01');
      expect(mockDevices.length).toBe(1);
    });

    test('1.2 Admin mengatur konfigurasi threshold untuk node tersebut', async () => {
      // Seed device
      mockDevices.push({ id: 1, node_id: 'INTEGRATION-NODE-01', name: 'Node Tambak Utama' });
      
      const res = await request(app)
        .put('/api/config/thresholds/INTEGRATION-NODE-01')
        .set('Authorization', adminToken)
        .send({
          thresholds: [
            { parameter: 'suhu', batas_bawah: 25.0, batas_atas: 31.0 },
            { parameter: 'salinitas', batas_bawah: 10.0, batas_atas: 20.0 }
          ]
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Thresholds updated/);
      expect(mockThresholds.length).toBe(2);
      expect(mockThresholds[0].batas_atas).toBe(31.0);
    });

    test('1.3 User biasa membaca konfigurasi threshold', async () => {
      mockDevices.push({ id: 1, node_id: 'INTEGRATION-NODE-01', name: 'Node Tambak Utama' });
      mockThresholds.push({ device_id: 1, parameter: 'suhu', batas_bawah: 25, batas_atas: 31 });

      const res = await request(app)
        .get('/api/config/thresholds')
        .set('Authorization', userToken);
      
      expect(res.status).toBe(200);
      expect(res.body.thresholds).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SKENARIO 2: Logika Cerdas (Fuzzy DSS)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Skenario 2: Simulasi DSS Fuzzy berdasar Data Sensor', () => {
    test('2.1 DSS memproses nilai aman (Suhu 29, Salinitas 20)', async () => {
      const res = await request(app)
        .post('/api/dss/simulate')
        .set('Authorization', userToken)
        .send({ suhu: 29.0, salinitas: 20.0 });
      
      expect(res.status).toBe(200);
      expect(res.body.recommendation).toBe('Aman');
      expect(res.body.score).toBeLessThan(35); 
    });

    test('2.2 DSS memproses nilai kritis ekstrim (Suhu 35, Salinitas 5)', async () => {
      const res = await request(app)
        .post('/api/dss/simulate')
        .set('Authorization', userToken)
        .send({ suhu: 35.0, salinitas: 5.0 }); // Sangat tinggi, sangat rendah
      
      expect(res.status).toBe(200);
      expect(res.body.recommendation).toBe('Bahaya');
      expect(res.body.score).toBeGreaterThan(65);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SKENARIO 3: Trigger Notifikasi dan Respon Aktuator
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Skenario 3: Alur Kritis Notifikasi ke Aktuator', () => {
    test('3.1 Sistem trigger alert manual/otomatis karena threshold terlampaui', async () => {
      mockDevices.push({ id: 1, node_id: 'INTEGRATION-NODE-01', name: 'Node Tambak Utama' });
      
      const res = await request(app)
        .post('/api/notifications/trigger')
        .set('Authorization', userToken) // Any role can trigger via MQTT logic normally, here we simulate API trigger
        .send({
          device_id: 'INTEGRATION-NODE-01',
          parameter: 'suhu',
          measured_value: 36.5,
          threshold_min: 26.0,
          threshold_max: 32.0,
          level_peringatan: 'danger',
          pesan_notifikasi: 'Suhu sangat tinggi (36.5C), bahaya mematikan bagi bandeng!'
        });
      
      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/dispatched/);
      expect(mockLogs.length).toBe(1);
      expect(mockLogs[0].level_peringatan).toBe('danger');
    });

    test('3.2 Admin melihat histori alert tersebut', async () => {
      mockLogs.push({ id: 99, device_id: 'INTEGRATION-NODE-01', parameter: 'suhu', measured_value: 36.5, level_peringatan: 'danger' });

      const res = await request(app)
        .get('/api/logs')
        .set('Authorization', adminToken);
      
      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBe(1);
      expect(res.body.logs[0].measured_value).toBe(36.5);
    });

    test('3.3 Admin menyalakan pompa sirkulasi merespon alert', async () => {
      mockDevices.push({ id: 1, node_id: 'INTEGRATION-NODE-01', name: 'Node Tambak Utama' });
      const res = await request(app)
        .post('/api/actuator/command')
        .set('Authorization', adminToken)
        .send({ device_id: 1, aksi: 'PUMP_ENGINE_START' });
      
      expect(res.status).toBe(202);
      expect(res.body.aksi).toBe('PUMP_ENGINE_START');
      expect(mockActuatorLogs.length).toBe(1);
    });

    test('3.4 Cek status aktuator pasca eksekusi', async () => {
      mockDevices.push({ id: 1, node_id: 'INTEGRATION-NODE-01', name: 'Node Tambak Utama' });
      mockActuatorLogs.push({ id: 1, device_id: 1, aksi: 'PUMP_ENGINE_START', trigger_source: 'manual', status: 'pending' });

      const res = await request(app)
        .get('/api/actuator/status/1')
        .set('Authorization', adminToken);
      
      expect(res.status).toBe(200);
      expect(res.body.recent_actions.length).toBe(1);
      expect(res.body.recent_actions[0].aksi).toBe('PUMP_ENGINE_START');
    });
  });
});
