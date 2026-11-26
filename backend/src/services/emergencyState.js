'use strict';

const db = require('../config/db');
const tq = require('../config/telegramQueue');

const FAILSAFE_VERIFY_WINDOW_MS = parseInt(
  process.env.FAILSAFE_VERIFY_WINDOW_MS || '15000', 10
);
const VIBRATION_THRESHOLD = parseFloat(process.env.VIBRATION_THRESHOLD || '0.3');
const EMERGENCY_NOTIFY_COOLDOWN_MS = 2 * 60 * 1000;

const deviceStates = new Map();

// Fire-and-forget durable persistence; skips high-frequency vibration timestamps.
function _persist(deviceId) {
  let pool;
  try { pool = db.getPool(); } catch { return; }
  const s = deviceStates.get(deviceId);
  if (!s) return;
  const p = [deviceId, s.emergencyActive ? 1 : 0, s.emergencyActivatedAt ?? null, s.engineStopPending ? 1 : 0,
    s.engineStopSentAt ?? null, s.engineStopCommandId ?? null, s.lastNotifiedAt ?? null];
  try {
    Promise.resolve(pool.execute(
      `INSERT INTO emergency_state
         (device_id, emergency_active, emergency_activated_at, engine_stop_pending, engine_stop_sent_at, engine_stop_command_id, last_notified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         emergency_active = VALUES(emergency_active), emergency_activated_at = VALUES(emergency_activated_at),
         engine_stop_pending = VALUES(engine_stop_pending), engine_stop_sent_at = VALUES(engine_stop_sent_at),
         engine_stop_command_id = VALUES(engine_stop_command_id), last_notified_at = VALUES(last_notified_at)`,
      p
    )).catch((e) => console.error(`[Failsafe] persist FAILED device=${deviceId}: ${e.message}`));
  } catch (e) {
    console.error(`[Failsafe] persist FAILED device=${deviceId}: ${e.message}`);
  }
}

// Restores failsafe state before initMQTT; if DB load fails in server.js, state starts fail-open.
async function loadEmergencyStates() {
  const [rows] = await db.getPool().execute(
    'SELECT * FROM emergency_state WHERE emergency_active = 1 OR engine_stop_pending = 1'
  );
  const num = (v) => (v == null ? null : Number(v));
  for (const r of rows) {
    const s = initDeviceState(Number(r.device_id));
    s.emergencyActive      = !!r.emergency_active;
    s.emergencyActivatedAt = num(r.emergency_activated_at);
    s.engineStopPending    = !!r.engine_stop_pending;
    s.engineStopSentAt     = num(r.engine_stop_sent_at);
    s.engineStopCommandId  = num(r.engine_stop_command_id);
    s.lastNotifiedAt       = num(r.last_notified_at);
  }
  return rows.length;
}

function initDeviceState(deviceId) {
  if (!deviceStates.has(deviceId)) {
    deviceStates.set(deviceId, {
      engineStopPending    : false,
      engineStopSentAt     : null,
      engineStopCommandId  : null,
      emergencyActive      : false,
      emergencyActivatedAt : null,
      lastVibratingAt      : null,
      lastNotifiedAt       : null,
    });
  }
  return deviceStates.get(deviceId);
}

function getDeviceState(deviceId) {
  return deviceStates.get(deviceId) || initDeviceState(deviceId);
}

function isEmergencyActive(deviceId) {
  const state = deviceStates.get(deviceId);
  return state ? state.emergencyActive : false;
}

function markEngineStopSent(deviceId, commandId) {
  const state = initDeviceState(deviceId);
  state.engineStopPending   = true;
  state.engineStopSentAt    = Date.now();
  state.engineStopCommandId = commandId;
  _persist(deviceId);
  console.log(`[Failsafe] Engine stop sent for device ${deviceId}, command_id=${commandId}. Monitoring vibration for ${FAILSAFE_VERIFY_WINDOW_MS / 1000}s...`);
}

function resetEmergencyState(deviceId, force = false) {
  const state = getDeviceState(deviceId);
  const now = Date.now();
  // Block reset if vibration was seen within 5s unless latest reading explicitly confirms stopped.
  if (!force && state.isCurrentlyVibrating !== false && state.lastVibratingAt && (now - state.lastVibratingAt < 5000)) {
    throw new Error('Mesin masih terdeteksi bergetar (SW-420 aktif). Pastikan mesin diesel benar-benar mati sebelum melakukan reset darurat.');
  }
  state.emergencyActive      = false;
  state.emergencyActivatedAt = null;
  state.engineStopPending    = false;
  state.engineStopSentAt     = null;
  state.engineStopCommandId  = null;
  _persist(deviceId);
  console.log(`[Failsafe] Emergency state RESET for device ${deviceId}`);
}

async function handleVibrationData({ deviceId, nodeId, payload, io, mqttClient }) {
  const state       = initDeviceState(deviceId);
  const isVibrating = payload.vibration === true ||
                      (typeof payload.intensity === 'number' && payload.intensity >= VIBRATION_THRESHOLD);

  state.isCurrentlyVibrating = isVibrating;

  if (isVibrating) {
    state.lastVibratingAt = Date.now();
  }

  if (!state.engineStopPending) {
    if (io && isVibrating) {
      io.emit('sensor:vibration', {
        device_id : deviceId,
        node_id   : nodeId,
        vibrating : isVibrating,
        intensity : payload.intensity ?? null,
        timestamp : new Date(),
      });
    }
    return;
  }

  const elapsed = Date.now() - state.engineStopSentAt;

  if (!isVibrating) {
    // Require 2s of quiet after PUMP_ENGINE_STOP before confirming stop.
    if (elapsed >= 2000) {
      state.engineStopPending = false;
      _persist(deviceId);
      console.log(`[Failsafe] ✓ Engine STOPPED confirmed for device ${deviceId} (elapsed: ${elapsed}ms)`);

      if (state.engineStopCommandId) {
        try {
          const pool = db.getPool();
          await pool.execute(
            'UPDATE actuator_logs SET status = ?, trigger_detail = ? WHERE id = ?',
            ['executed', `Engine stop confirmed by SW-420 (elapsed: ${elapsed}ms)`, state.engineStopCommandId]
          );
        } catch (e) {
          console.error('[Failsafe] Failed to update actuator log:', e.message);
        }
      }

      if (io) {
        io.emit('actuator:confirmed', {
          device_id  : deviceId,
          node_id    : nodeId,
          aksi       : 'PUMP_ENGINE_STOP',
          status     : 'confirmed',
          elapsed_ms : elapsed,
          timestamp  : new Date(),
        });
      }
    }
    return;
  }

  if (elapsed >= FAILSAFE_VERIFY_WINDOW_MS && isVibrating) {
    state.engineStopPending = false;

    if (state.emergencyActive) {
      const timeSinceLastNotify = Date.now() - (state.lastNotifiedAt || 0);
      if (timeSinceLastNotify < EMERGENCY_NOTIFY_COOLDOWN_MS) return;
    }

    state.emergencyActive      = true;
    state.emergencyActivatedAt = Date.now();
    state.lastNotifiedAt       = Date.now();
    _persist(deviceId);

    console.error(`[Failsafe] 🆘 EMERGENCY STATE ACTIVATED for device ${deviceId} (${nodeId}) — engine still vibrating after STOP command!`);

    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(
        `tambak/${nodeId}/actuator/command`,
        JSON.stringify({ aksi: 'EMERGENCY_STOP', command_id: null }),
        { qos: 2 }
      );
    }

    try {
      const pool = db.getPool();
      await pool.execute(
        'INSERT INTO actuator_logs (device_id, aksi, trigger_source, trigger_detail, status) VALUES (?, ?, ?, ?, ?)',
        [deviceId, 'EMERGENCY_STOP', 'failsafe', `SW-420 Failsafe triggered: pump still vibrating after ${elapsed}ms`, 'executed']
      );
    } catch (actLogErr) {
      console.error('[Failsafe] Failed to write EMERGENCY_STOP to actuator_logs:', actLogErr.message);
    }

    try {
      const { abortSequence } = require('./actuatorController');
      abortSequence(deviceId);
    } catch (e) {
      console.error(`[Failsafe] Failed to abort sequence:`, e.message);
    }

    const emergencyMsg = `🆘 FAILSAFE DARURAT: Mesin diesel pada node ${nodeId} gagal mati setelah perintah PUMP_ENGINE_STOP! Risiko LUAPAN AIR (overfilling). Segera periksa secara fisik!`;

    try {
      const pool = db.getPool();
      await pool.execute(
        `INSERT INTO alert_logs
           (device_id, parameter, measured_value, threshold_min, threshold_max, level_peringatan, pesan_notifikasi)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [deviceId, 'vibration_failsafe', payload.intensity ?? 1, 0, VIBRATION_THRESHOLD, 'failsafe', emergencyMsg]
      );

      if (state.engineStopCommandId) {
        await pool.execute(
          'UPDATE actuator_logs SET status = ?, trigger_detail = ? WHERE id = ?',
          ['failed', `FAILSAFE: Engine still vibrating after ${elapsed}ms`, state.engineStopCommandId]
        );
      }
    } catch (dbErr) {
      console.error('[Failsafe] Failed to write emergency alert to DB:', dbErr.message);
    }

    if (io) {
      io.emit('system:emergency', {
        device_id        : deviceId,
        node_id          : nodeId,
        type             : 'pump_failsafe',
        message          : emergencyMsg,
        vibration_elapsed: elapsed,
        risk             : 'OVERFILLING',
        timestamp        : new Date(),
        actions_required : [
          'Periksa mesin diesel secara fisik',
          'Pastikan katup kuras terbuka',
          'Reset emergency state via Admin Dashboard setelah kondisi aman',
        ],
      });
    }

    tq.sendEmergency({
      deviceId,
      nodeId,
      message: emergencyMsg,
    });
  }
}

function getAllEmergencyStates() {
  const result = [];
  for (const [deviceId, state] of deviceStates.entries()) {
    if (state.emergencyActive || state.engineStopPending) {
      result.push({
        device_id            : deviceId,
        emergency_active     : state.emergencyActive,
        emergency_activated_at: state.emergencyActivatedAt
          ? new Date(state.emergencyActivatedAt).toISOString()
          : null,
        engine_stop_pending  : state.engineStopPending,
        engine_stop_sent_at  : state.engineStopSentAt
          ? new Date(state.engineStopSentAt).toISOString()
          : null,
        last_vibrating_at    : state.lastVibratingAt
          ? new Date(state.lastVibratingAt).toISOString()
          : null,
      });
    }
  }
  return result;
}

module.exports = {
  handleVibrationData,
  markEngineStopSent,
  resetEmergencyState,
  loadEmergencyStates,
  isEmergencyActive,
  getAllEmergencyStates,
  getDeviceState,
  FAILSAFE_VERIFY_WINDOW_MS,
  VIBRATION_THRESHOLD,
};
