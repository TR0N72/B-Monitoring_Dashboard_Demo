'use strict';
// end_date berupa tanggal saja (YYYY-MM-DD) harus mencakup seluruh hari itu; tanpa ini MySQL membacanya 00:00:00.
const endOfDay = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s} 23:59:59` : s);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;
// Tanggal kalender nyata? (menolak 2026-13-45 yang lolos regex)
const validDate = (s) => {
  const m = typeof s === 'string' && DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
// Middleware: start_date/end_date rusak -> 400, bukan 500 dari MySQL.
const dateGuard = (req, res, next) => {
  for (const k of ['start_date', 'end_date']) {
    if (req.query[k] !== undefined && req.query[k] !== '' && !validDate(req.query[k])) {
      return res.status(400).json({ error: `${k} tidak valid (format YYYY-MM-DD atau YYYY-MM-DD HH:mm:ss).` });
    }
  }
  next();
};
module.exports = { endOfDay, validDate, dateGuard };
