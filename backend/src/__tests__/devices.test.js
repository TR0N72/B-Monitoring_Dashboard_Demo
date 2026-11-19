'use strict';
process.env.JWT_SECRET = 'bmonitor_dev_secret';
const mockExecute = jest.fn();
jest.mock('../config/db', () => ({ getPool: jest.fn(() => ({ execute: mockExecute, query: jest.fn() })) }));

const request = require('supertest');
const express = require('express');
const { makeToken } = require('./helpers/tokenHelper');
const app = express();
app.use(express.json());
app.use('/api/devices', require('../routes/devices.routes'));
const admin = { Authorization: makeToken('admin') };

beforeEach(() => mockExecute.mockReset());

test('PUT 403 for non-admin', async () => {
  const r = await request(app).put('/api/devices/1').set({ Authorization: makeToken('operator') }).send({ name: 'x' });
  expect(r.status).toBe(403);
});

test.each([
  [{ name: '  ' }], [{ name: 'a'.repeat(101) }], [{ type: 'router' }],
  [{ status: 'broken' }], [{ mac_address: 'zz' }], [{ lokasi: 'l'.repeat(256) }], [{}],
])('PUT 400 for invalid body %j', async (body) => {
  const r = await request(app).put('/api/devices/1').set(admin).send(body);
  expect(r.status).toBe(400);
  expect(mockExecute).not.toHaveBeenCalled();
});

test('PUT updates trimmed name, ignores node_id, blank mac -> NULL', async () => {
  mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
  const r = await request(app).put('/api/devices/18').set(admin)
    .send({ node_id: 'HACK', name: ' Node 1 ', mac_address: '', status: 'maintenance' });
  expect(r.status).toBe(200);
  const [sql, vals] = mockExecute.mock.calls[0];
  expect(sql).not.toMatch(/node_id/);
  expect(vals).toEqual(['Node 1', null, 'maintenance', '18']);
});

test('PUT 404 when device missing', async () => {
  mockExecute.mockResolvedValue([{ affectedRows: 0 }]);
  const r = await request(app).put('/api/devices/99').set(admin).send({ name: 'x' });
  expect(r.status).toBe(404);
});
