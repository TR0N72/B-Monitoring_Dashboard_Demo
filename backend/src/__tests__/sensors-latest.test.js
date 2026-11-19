'use strict';
process.env.JWT_SECRET = 'bmonitor_dev_secret';
const mockExecute = jest.fn();
jest.mock('../config/db', () => ({ getPool: jest.fn(() => ({ execute: mockExecute, query: jest.fn() })) }));

const request = require('supertest');
const express = require('express');
const { makeToken } = require('./helpers/tokenHelper');
const app = express();
app.use('/api/sensors', require('../routes/sensors.routes'));
const auth = { Authorization: makeToken('user') };

beforeEach(() => mockExecute.mockReset());

test('/latest selects DSS columns for every node (all-nodes query)', async () => {
  mockExecute.mockResolvedValue([[{ node_id: 'N1', dss_score: 20, dss_recommendation: 'Aman' }]]);
  const r = await request(app).get('/api/sensors/latest').set(auth);
  expect(r.status).toBe(200);
  expect(r.body.readings[0]).toMatchObject({ dss_score: 20, dss_recommendation: 'Aman' });
  expect(mockExecute.mock.calls[0][0]).toMatch(/dss_score/);
  expect(mockExecute.mock.calls[0][0]).toMatch(/dss_recommendation/);
});

test('/latest?device_id=N1 binds node id and keeps DSS columns', async () => {
  mockExecute.mockResolvedValue([[]]);
  await request(app).get('/api/sensors/latest?device_id=N1').set(auth);
  expect(mockExecute.mock.calls[0][1]).toEqual(['N1']);
  expect(mockExecute.mock.calls[0][0]).toMatch(/dss_score/);
});

test('/latest returns 500 on DB error', async () => {
  mockExecute.mockRejectedValue(new Error('down'));
  const r = await request(app).get('/api/sensors/latest').set(auth);
  expect(r.status).toBe(500);
});
