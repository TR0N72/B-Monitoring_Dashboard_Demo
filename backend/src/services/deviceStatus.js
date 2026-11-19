// Tandai device offline bila tak ada data > DEVICE_OFFLINE_SEC (default 90 dtk; node kirim tiap 10 dtk).
// Online otomatis lagi lewat mqtt.js saat data masuk. 'maintenance' tidak disentuh.
const { getPool } = require('../config/db');

const sweepSec = () => Number(process.env.DEVICE_OFFLINE_SEC) > 0 ? Number(process.env.DEVICE_OFFLINE_SEC) : 90;

async function markStaleOffline() {
  const [r] = await getPool().execute(
    "UPDATE devices SET status = 'offline' WHERE status = 'online' AND (last_seen IS NULL OR last_seen < NOW() - INTERVAL ? SECOND)",
    [sweepSec()]
  );
  return r.affectedRows;
}

function startDeviceStatusSweep() {
  const run = () => markStaleOffline().then((n) => n && console.log(`[Devices] ${n} device offline (tanpa data > ${sweepSec()} dtk)`)).catch((e) => console.error('[Devices] sweep:', e.message));
  run();
  const t = setInterval(run, 30000);
  t.unref();
  return t;
}

module.exports = { startDeviceStatusSweep, markStaleOffline };
