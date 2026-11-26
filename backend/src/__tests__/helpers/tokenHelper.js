'use strict';

const jwt  = require('jsonwebtoken');
const { JWT_SECRET } = require('../../middleware/auth');

function makeToken(role = 'user', overrides = {}) {
  const payload = { id: 1, username: role === 'admin' ? 'admin' : 'petambak', role, ...overrides };
  return `Bearer ${jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })}`;
}

function makeExpiredToken(role = 'user') {
  const payload = { id: 1, username: 'petambak', role };
  return `Bearer ${jwt.sign(payload, JWT_SECRET, { expiresIn: -1 })}`;
}

function makeTamperedToken() {
  const payload = { id: 1, username: 'hacker', role: 'admin' };
  return `Bearer ${jwt.sign(payload, 'wrong_secret_lol', { expiresIn: '1h' })}`;
}

function makeSelfSignedAdminToken() {
  const payload = { id: 99, username: 'evil', role: 'admin' };
  return `Bearer ${jwt.sign(payload, 'i_am_not_the_real_secret', { expiresIn: '1h' })}`;
}

module.exports = { makeToken, makeExpiredToken, makeTamperedToken, makeSelfSignedAdminToken };
