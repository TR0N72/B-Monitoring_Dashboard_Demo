'use strict';
process.env.JWT_SECRET = 'bmonitor_dev_secret';
const mockQuery = jest.fn();
jest.mock('../config/db', () => ({ getPool: jest.fn(() => ({ query: mockQuery, execute: jest.fn() })) }));
jest.mock('../socket/alerts', () => ({ getIo: () => null }));

const request = require('supertest');
const express = require('express');
const { makeToken } = require('./helpers/tokenHelper');
const app = express();
app.use(express.json());
app.use('/api/ai', require('../routes/ai.routes'));
const IMG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const auth = () => ({ Authorization: makeToken('admin') });

beforeEach(() => {
  mockQuery.mockReset();
  global.fetch = jest.fn();
});

test('401 without token', async () => {
  const r = await request(app).post('/api/ai/analyze?node_id=N1').set('Content-Type', 'image/jpeg').send(IMG);
  expect(r.status).toBe(401);
});

test('400 without node_id / without image', async () => {
  let r = await request(app).post('/api/ai/analyze').set(auth()).set('Content-Type', 'image/jpeg').send(IMG);
  expect(r.status).toBe(400);
  r = await request(app).post('/api/ai/analyze?node_id=N1').set(auth()).send({});
  expect(r.status).toBe(400);
});

test('201: forwards image, stores detection with AI label', async () => {
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({
    label: 'Warning', confidence: 0.97, model_version: 'TSS2_HGB_exp11', hsv_metadata: { predicted_class: 'Class 5' } }) });
  mockQuery.mockResolvedValueOnce([[{ id: 18, node_id: 'N1' }]]).mockResolvedValueOnce([{ insertId: 5 }]);
  const r = await request(app).post('/api/ai/analyze?node_id=N1').set(auth()).set('Content-Type', 'image/jpeg').send(IMG);
  expect(r.status).toBe(201);
  expect(r.body.data).toMatchObject({ id: 5, node_id: 'N1', label: 'Warning', confidence: 0.97 });
  expect(global.fetch.mock.calls[0][0]).toMatch(/\/predict$/);
});

test('422 when AI service cannot decode; 502 when it is down; 404 unknown node', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 400 });
  let r = await request(app).post('/api/ai/analyze?node_id=N1').set(auth()).set('Content-Type', 'image/jpeg').send(IMG);
  expect(r.status).toBe(422);
  global.fetch.mockResolvedValue({ ok: false, status: 413 });
  r = await request(app).post('/api/ai/analyze?node_id=N1').set(auth()).set('Content-Type', 'image/jpeg').send(IMG);
  expect(r.status).toBe(422);
  global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
  r = await request(app).post('/api/ai/analyze?node_id=N1').set(auth()).set('Content-Type', 'image/jpeg').send(IMG);
  expect(r.status).toBe(502);
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ label: 'Normal', confidence: 0.9 }) });
  mockQuery.mockResolvedValueOnce([[]]);
  r = await request(app).post('/api/ai/analyze?node_id=NOPE').set(auth()).set('Content-Type', 'image/jpeg').send(IMG);
  expect(r.status).toBe(404);
});

test('422 with reason when AI service rejects photo quality', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: 'too_dark' }) });
  const r = await request(app).post('/api/ai/analyze?node_id=N1').set(auth()).set('Content-Type', 'image/jpeg').send(IMG);
  expect(r.status).toBe(422);
  expect(r.body.reason).toBe('too_dark');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('201 low confidence is stored but flagged used_for_dss=false', async () => {
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ label: 'Warning', confidence: 0.45, model_version: 'm' }) });
  mockQuery.mockResolvedValueOnce([[{ id: 18, node_id: 'N1' }]]).mockResolvedValueOnce([{ insertId: 6 }]);
  const r = await request(app).post('/api/ai/analyze?node_id=N1').set(auth()).set('Content-Type', 'image/jpeg').send(IMG);
  expect(r.status).toBe(201);
  expect(r.body.data.used_for_dss).toBe(false);
});

test('403 role user on analyze, detections, capture', async () => {
  const u = { Authorization: makeToken('user') };
  for (const p of ['/api/ai/analyze?node_id=N1', '/api/ai/detections', '/api/ai/capture']) {
    const r = await request(app).post(p).set(u).set('Content-Type', 'image/jpeg').send(IMG);
    expect(r.status).toBe(403);
  }
});

test('400 capture with MQTT wildcard node_id', async () => {
  for (const node_id of ['#', 'a/+', 'N1/../x']) {
    const r = await request(app).post('/api/ai/capture').set(auth()).send({ node_id });
    expect(r.status).toBe(400);
  }
});
