'use strict';
// Blacklist JWT yang sudah logout. Cek sinkron dari memori; DB (revoked_tokens) agar bertahan saat restart.
// ponytail: satu proses backend. Banyak instance -> pindah ke Redis.
const crypto = require('crypto');
const { getPool } = require('../config/db');

const revoked = new Map(); // sha256(token) -> exp (ms)
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function purge() {
  const now = Date.now();
  for (const [k, exp] of revoked) if (exp <= now) revoked.delete(k);
}

function isRevoked(token) {
  const exp = revoked.get(hash(token));
  if (exp === undefined) return false;
  if (exp <= Date.now()) { revoked.delete(hash(token)); return false; }
  return true;
}

async function revoke(token, expSec) {
  const expMs = (expSec || Math.floor(Date.now() / 1000) + 86400) * 1000;
  revoked.set(hash(token), expMs);
  try {
    await getPool().execute(
      'INSERT IGNORE INTO revoked_tokens (token_hash, expires_at) VALUES (?, FROM_UNIXTIME(?))',
      [hash(token), Math.floor(expMs / 1000)]);
  } catch (err) {
    console.error('[AUTH] revoke persist gagal (tetap aktif di memori):', err.message);
  }
}

async function loadRevoked() {
  const pool = getPool();
  await pool.execute('DELETE FROM revoked_tokens WHERE expires_at <= NOW()');
  const [rows] = await pool.execute(
    'SELECT token_hash, UNIX_TIMESTAMP(expires_at) AS exp FROM revoked_tokens');
  for (const r of rows) revoked.set(r.token_hash, Number(r.exp) * 1000);
  return rows.length;
}

setInterval(purge, 60 * 60 * 1000).unref();

module.exports = { isRevoked, revoke, loadRevoked };
