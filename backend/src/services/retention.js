// Roll-up sensor_data -> sensor_hourly (jam penuh saja, idempotent) + hapus data mentah lama.
// Hapus hanya jika SENSOR_RETENTION_DAYS > 0 (default 0 = mati, tak ada data hilang tanpa sengaja)
// dan hanya baris yang sudah masuk roll-up. Tabel anak: fuzzy_decisions ikut terhapus (FK CASCADE), AI logs jadi NULL.
const { getPool } = require('../config/db');

const days = () => (Number(process.env.SENSOR_RETENTION_DAYS) > 0 ? Math.floor(Number(process.env.SENSOR_RETENTION_DAYS)) : 0);
const HOUR = "DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00')";

async function rollup(pool = getPool()) {
  // Mulai dari jam terakhir yang sudah ada (dihitung ulang penuh), sampai awal jam berjalan.
  const [r] = await pool.query(`
    INSERT INTO sensor_hourly (device_id, hour_start, n, suhu_avg, suhu_min, suhu_max,
      salinitas_avg, salinitas_min, salinitas_max, turbidity_avg, turbidity_min, turbidity_max, jarak_avg)
    SELECT device_id, DATE_FORMAT(recorded_at, '%Y-%m-%d %H:00:00') AS h, COUNT(*),
      AVG(suhu), MIN(suhu), MAX(suhu), AVG(salinitas), MIN(salinitas), MAX(salinitas),
      AVG(turbidity), MIN(turbidity), MAX(turbidity), AVG(jarak_cm)
    FROM sensor_data
    WHERE recorded_at < ${HOUR}
      AND recorded_at >= COALESCE((SELECT MAX(hour_start) FROM sensor_hourly), '1970-01-01')
    GROUP BY device_id, h
    ON DUPLICATE KEY UPDATE n = VALUES(n), suhu_avg = VALUES(suhu_avg), suhu_min = VALUES(suhu_min),
      suhu_max = VALUES(suhu_max), salinitas_avg = VALUES(salinitas_avg), salinitas_min = VALUES(salinitas_min),
      salinitas_max = VALUES(salinitas_max), turbidity_avg = VALUES(turbidity_avg),
      turbidity_min = VALUES(turbidity_min), turbidity_max = VALUES(turbidity_max), jarak_avg = VALUES(jarak_avg)`);
  return r.affectedRows;
}

async function purge(pool = getPool()) {
  const d = days();
  if (!d) return 0;
  let total = 0;
  for (;;) { // potong per 10 ribu baris agar tak mengunci tabel lama
    const [r] = await pool.query(
      `DELETE FROM sensor_data WHERE recorded_at < NOW() - INTERVAL ? DAY
         AND recorded_at < COALESCE((SELECT MAX(hour_start) FROM sensor_hourly), '1970-01-01') LIMIT 10000`, [d]);
    total += r.affectedRows;
    if (r.affectedRows < 10000) return total;
  }
}

async function runRetention(pool) {
  const rolled = await rollup(pool);
  const purged = await purge(pool);
  return { rolled, purged };
}

function startRetention() {
  const run = () => runRetention().then(({ rolled, purged }) => (rolled || purged) && console.log(`[Retention] roll-up ${rolled}, dihapus ${purged}`)).catch((e) => console.error('[Retention]', e.message));
  run();
  const t = setInterval(run, 6 * 3600 * 1000);
  t.unref();
  return t;
}

module.exports = { rollup, purge, runRetention, startRetention };
