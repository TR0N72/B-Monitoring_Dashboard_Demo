'use strict';
// Satu aturan password untuk semua jalur (buat user, ubah user, register, reset). Batas 72 = batas bcrypt.
function passwordError(p) {
  if (typeof p !== 'string' || p.length < 8) return 'Password minimal 8 karakter.';
  if (Buffer.byteLength(p) > 72) return 'Password maksimal 72 byte.';
  return null;
}
module.exports = { passwordError };
