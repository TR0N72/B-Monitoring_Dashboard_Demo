'use strict';
// Validasi akun per request: user dihapus -> ditolak, role diambil dari DB, token terbit sebelum
// perubahan akun terakhir (password/role/kontak, kolom updated_at) ditolak. Cache 30 dtk per user.
// ponytail: cache per proses; banyak instance -> perubahan baru terlihat paling lama 30 dtk. DB error -> pakai klaim token (fail-open).
const { getPool } = require('../config/db');

const TTL_MS = 30 * 1000;
const cache = new Map(); // id -> { at, row }

function invalidate(id) { cache.delete(Number(id)); }

async function lookup(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;
  const [rows] = await getPool().query('SELECT role, UNIX_TIMESTAMP(updated_at) AS ts FROM users WHERE id = ?', [id]);
  const row = rows[0] ? { role: rows[0].role, ts: Number(rows[0].ts) } : null;
  cache.set(id, { at: Date.now(), row });
  return row;
}

/** Klaim token terverifikasi -> user efektif, atau null bila akun sudah tidak berlaku. */
async function resolveUser(decoded) {
  let row;
  try {
    row = await lookup(Number(decoded.id));
  } catch (err) {
    console.error('[AUTH] cek akun gagal, pakai klaim token:', err.message);
    return decoded;
  }
  if (!row || decoded.iat < row.ts) return null;
  return { ...decoded, role: row.role };
}

module.exports = { resolveUser, invalidate };
