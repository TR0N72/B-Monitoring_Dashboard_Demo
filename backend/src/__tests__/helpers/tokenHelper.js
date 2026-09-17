'use strict';
/**
 * Test Helper — Token & App Utilities
 * =====================================
 * Menghasilkan JWT token valid/expired/manipulated untuk test tanpa
 * bergantung pada database.
 */
const jwt  = require('jsonwebtoken');
const { JWT_SECRET } = require('../../middleware/auth');

/**
 * Generate token valid untuk user berdasarkan role
 * @param {'admin'|'user'} role
 * @param {object} overrides — override payload
 * @returns {string} Bearer token string
 */
function makeToken(role = 'user', overrides = {}) {
  const payload = { id: 1, username: role === 'admin' ? 'admin' : 'petambak', role, ...overrides };
  return `Bearer ${jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })}`;
}

/**
 * Generate expired token (expiresIn -1s)
 * @param {'admin'|'user'} role
 */
function makeExpiredToken(role = 'user') {
  const payload = { id: 1, username: 'petambak', role };
  return `Bearer ${jwt.sign(payload, JWT_SECRET, { expiresIn: -1 })}`;
}

/**
 * Generate token signed dengan secret yang salah
 */
function makeTamperedToken() {
  const payload = { id: 1, username: 'hacker', role: 'admin' };
  return `Bearer ${jwt.sign(payload, 'wrong_secret_lol', { expiresIn: '1h' })}`;
}

/**
 * Generate token dengan payload yang dimanipulasi (self-signed admin)
 */
function makeSelfSignedAdminToken() {
  const payload = { id: 99, username: 'evil', role: 'admin' };
  return `Bearer ${jwt.sign(payload, 'i_am_not_the_real_secret', { expiresIn: '1h' })}`;
}

module.exports = { makeToken, makeExpiredToken, makeTamperedToken, makeSelfSignedAdminToken };
