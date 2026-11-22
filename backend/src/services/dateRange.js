'use strict';
// end_date berupa tanggal saja (YYYY-MM-DD) harus mencakup seluruh hari itu; tanpa ini MySQL membacanya 00:00:00.
const endOfDay = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s} 23:59:59` : s);
module.exports = { endOfDay };
