// Tandai device offline bila tak ada data > DEVICE_OFFLINE_SEC (default 90 dtk; node kirim tiap 10 dtk).
// Online otomatis lagi lewat mqtt.js saat data masuk. 'maintenance' tidak disentuh.
// Tiap transisi online -> offline = 1 alert_logs + Telegram + socket (UPDATE terjaga, affectedRows===1 => 1 alert per outage).
const { getPool } = require('../config/db');
const { sendTelegramAlert } = require('../config/telegram');
const { getIo } = require('../socket/alerts');

const sweepSec = () => Number(process.env.DEVICE_OFFLINE_SEC) > 0 ? Number(process.env.DEVICE_OFFLINE_SEC) : 90;
const STALE = '(last_seen IS NULL OR last_seen < NOW() - INTERVAL ? SECOND)';

async function alertOffline(pool, d, sec) {
  const measured = d.last_seen ? Math.max(0, Math.round((Date.now() - new Date(d.last_seen).getTime()) / 1000)) : sec;
  const a = {
    device_id: d.id, node_id: d.node_id, parameter: 'device_offline', measured_value: measured,
    threshold_min: 0, threshold_max: sec, level_peringatan: 'critical',
    pesan_notifikasi: `Device ${d.node_id} offline: tidak ada data > ${sec} dtk`,
  };
  try {
    await pool.execute(
      'INSERT INTO alert_logs (device_id, parameter, measured_value, threshold_min, threshold_max, level_peringatan, pesan_notifikasi) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [a.device_id, a.parameter, a.measured_value, a.threshold_min, a.threshold_max, a.level_peringatan, a.pesan_notifikasi]
    );
  } catch (e) { console.error('[Devices] alert_logs offline:', e.message); }
  try { await sendTelegramAlert(a); } catch (e) { console.error('[Devices] telegram offline:', e.message); }
  try { getIo()?.to('alerts').emit('new_alert', { ...a, timestamp: new Date().toISOString() }); } catch (e) { console.error('[Devices] socket offline:', e.message); }
}

async function markStaleOffline() {
  const pool = getPool();
  const sec = sweepSec();
  const [rows] = await pool.execute(`SELECT id, node_id, last_seen FROM devices WHERE status = 'online' AND ${STALE}`, [sec]);
  let n = 0;
  for (const d of rows) {
    try {
      const [r] = await pool.execute(`UPDATE devices SET status = 'offline' WHERE id = ? AND status = 'online' AND ${STALE}`, [d.id, sec]);
      if (r.affectedRows !== 1) continue; // sweep lain sudah menang
      n++;
      await alertOffline(pool, d, sec);
    } catch (e) { console.error(`[Devices] offline device=${d.id}:`, e.message); }
  }
  return n;
}

function startDeviceStatusSweep() {
  const run = () => markStaleOffline().then((n) => n && console.log(`[Devices] ${n} device offline (tanpa data > ${sweepSec()} dtk)`)).catch((e) => console.error('[Devices] sweep:', e.message));
  run();
  const t = setInterval(run, 30000);
  t.unref();
  return t;
}

module.exports = { startDeviceStatusSweep, markStaleOffline };
