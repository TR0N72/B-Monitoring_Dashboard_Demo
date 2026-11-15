// Scheduler siklus ukur: kirim START_CYCLE ke node tiap CYCLE_INTERVAL_MIN menit.
// Mati bila CYCLE_INTERVAL_MIN kosong/0. CYCLE_NODES = daftar node_id dipisah koma (default N1).
// ponytail: interval global satu nilai, tanpa jadwal per node atau jam kerja; tambah tabel bila perlu.
const { getPool } = require('../config/db');
const { publishMQTT } = require('../config/mqtt');
const { ACTION_CMD } = require('./actuatorController');
const { isEmergencyActive } = require('./emergencyState');

const PENDING_WINDOW_MIN = 20; // START_CYCLE tanpa ack dianggap masih berjalan selama ini

async function tick(nodes) {
  const pool = getPool();
  const sent = [];
  for (const nodeId of nodes) {
    const [dev] = await pool.execute('SELECT id FROM devices WHERE node_id = ?', [nodeId]);
    if (!dev.length) { console.warn(`[Scheduler] skip ${nodeId}: tidak terdaftar`); continue; }
    const id = dev[0].id;
    if (isEmergencyActive(id)) { console.warn(`[Scheduler] skip ${nodeId}: emergency aktif`); continue; }

    const [last] = await pool.execute(
      'SELECT siklus_status, recorded_at > NOW() - INTERVAL 2 MINUTE AS fresh FROM sensor_data WHERE device_id = ? ORDER BY id DESC LIMIT 1', [id]);
    if (last.length && last[0].fresh && !['IDLE', null].includes(last[0].siklus_status)) {
      console.warn(`[Scheduler] skip ${nodeId}: siklus berjalan (${last[0].siklus_status})`); continue;
    }
    const [busy] = await pool.execute(
      `SELECT id FROM actuator_logs WHERE device_id = ? AND aksi = 'START_CYCLE' AND status = 'pending'
       AND executed_at > NOW() - INTERVAL ${PENDING_WINDOW_MIN} MINUTE LIMIT 1`, [id]);
    if (busy.length) { console.warn(`[Scheduler] skip ${nodeId}: START_CYCLE sebelumnya belum di-ack`); continue; }

    const [r] = await pool.execute(
      'INSERT INTO actuator_logs (device_id, aksi, trigger_source, trigger_detail, status) VALUES (?, ?, ?, ?, ?)',
      [id, 'START_CYCLE', 'scheduler', 'Jadwal otomatis siklus ukur', 'pending']);
    publishMQTT(`tambak/${nodeId}/actuator/command`,
      { aksi: 'START_CYCLE', cmd: ACTION_CMD.START_CYCLE, command_id: r.insertId }, { qos: 1 });
    console.log(`[Scheduler] START_CYCLE → ${nodeId} (cmd_id: ${r.insertId})`);
    sent.push(nodeId);
  }
  return sent;
}

function startCycleScheduler() {
  const min = Number(process.env.CYCLE_INTERVAL_MIN);
  if (!(min > 0)) { console.log('Scheduler siklus ukur: mati (CYCLE_INTERVAL_MIN kosong)'); return null; }
  const nodes = (process.env.CYCLE_NODES || 'N1').split(',').map((s) => s.trim()).filter(Boolean);
  console.log(`✓ Scheduler siklus ukur: tiap ${min} menit untuk ${nodes.join(', ')}`);
  const t = setInterval(() => tick(nodes).catch((e) => console.error('[Scheduler]', e.message)), min * 60000);
  t.unref();
  return t;
}

module.exports = { startCycleScheduler, tick };
