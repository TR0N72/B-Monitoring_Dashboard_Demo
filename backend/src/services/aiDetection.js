'use strict';
const { getPool } = require('../config/db');

function normalizeLabel(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['caution', 'sakit', 'waspada'].includes(s)) return 'Caution';
  if (['warning', 'mati', 'bahaya'].includes(s)) return 'Warning';
  if (['normal', 'sehat'].includes(s)) return 'Normal';
  return null;
}

/** Validasi + simpan 1 deteksi AI + broadcast socket. Throw {status,message} bila input salah. */
async function saveDetection(body) {
  const { node_id, device_id, label, confidence, model_version = 'XGBoost_v1.0',
    detection_type = 'visual_classification', image_path = null, hsv_metadata = null, sensor_data_id = null } = body || {};
  const target = node_id || device_id;
  if (!target) throw { status: 400, message: 'node_id or device_id is required.' };
  if (confidence === undefined || confidence === null || isNaN(Number(confidence))) {
    throw { status: 400, message: 'Valid confidence (0.0 - 1.0) is required.' };
  }
  const conf = Math.max(0, Math.min(1, Number(confidence)));
  const lbl = normalizeLabel(label);
  if (!lbl) throw { status: 400, message: 'label must be Normal, Caution or Warning.' };
  const pool = getPool();
  const [devs] = await pool.query(
    'SELECT id, node_id FROM devices WHERE node_id = ?' + (isNaN(target) ? '' : ' OR id = ?'),
    isNaN(target) ? [String(target)] : [String(target), Number(target)]);
  if (!devs.length) throw { status: 404, message: `Device '${target}' not found.` };
  const hsv = hsv_metadata && typeof hsv_metadata === 'object' ? hsv_metadata : null;
  const [r] = await pool.query(
    `INSERT INTO ai_detection_logs (device_id, sensor_data_id, image_path, detection_type, label, confidence, model_version, hsv_metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [devs[0].id, sensor_data_id, image_path, detection_type, lbl, conf, model_version, hsv ? JSON.stringify(hsv) : null]);
  const out = { id: r.insertId, device_id: devs[0].id, node_id: devs[0].node_id, sensor_data_id, image_path,
    detection_type, label: lbl, confidence: conf, model_version, hsv_metadata: hsv, created_at: new Date().toISOString() };
  try { require('../socket/alerts').getIo()?.emit('ai:detection', out); } catch { /* socket optional */ }
  return out;
}

module.exports = { saveDetection, normalizeLabel };
