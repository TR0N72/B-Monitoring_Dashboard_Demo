'use strict';

jest.mock('../config/db', () => ({
  getPool: jest.fn(() => ({
    execute: jest.fn().mockResolvedValue([[{ id: 1, username: 'admin', password_hash: '$2a$10$abcdefghijklmnopqrstuuVmGKkZm7y6m7h4g1RFDUyYDM9wl8Ni', role: 'admin', name: 'Admin User', kontak_telegram: null }], {}]),
  })),
  initMySQL: jest.fn().mockResolvedValue(undefined),
  closeMySQL: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../config/mqtt', () => ({
  initMQTT: jest.fn().mockResolvedValue(undefined),
  closeMQTT: jest.fn().mockResolvedValue(undefined),
  publishMQTT: jest.fn().mockResolvedValue(undefined),
  getMQTTClient: jest.fn(() => null),
}));

jest.mock('../config/telegram', () => ({
  verifyBot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../config/telegramQueue', () => ({
  invalidateRouteCache: jest.fn(),
  loadPersisted: jest.fn().mockResolvedValue(0),
  getQueueStatus: jest.fn(() => ({ queueLength: 0, workers: [] })),
}));

jest.mock('../socket/alerts', () => ({
  initSocket: jest.fn(),
  emitAlert: jest.fn(),
}));

jest.mock('../services/emergencyState', () => ({
  getAllEmergencyStates: jest.fn(() => ({})),
  resetEmergencyState: jest.fn(),
  getDeviceState: jest.fn(() => ({ emergency: false, last_updated: null })),
}));
