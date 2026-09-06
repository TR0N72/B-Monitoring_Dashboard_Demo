'use strict';
/**
 * emergencyState.js — State Machine Failsafe Darurat (Sensor Getar SW-420)
 * =========================================================================
 * Modul ini menangani logika pemantauan darurat berbasis sensor getaran SW-420
 * yang dipasang pada mesin pompa diesel tambak.
 *
 * Protokol Failsafe:
 * ──────────────────────────────────────────────────────────────────
 *  Kondisi Normal :  Mesin diesel beroperasi → SW-420 mendeteksi getaran
 *  Perintah Stop  :  Backend mengirim PUMP_ENGINE_STOP via MQTT
 *  Verifikasi     :  Backend menunggu FAILSAFE_VERIFY_WINDOW_MS
 *  Berhasil       :  Getaran berhenti → status 'engine_stopped'
 *  GAGAL (Failsafe):  Getaran MASIH terdeteksi setelah PUMP_ENGINE_STOP →
 *                     Flag Emergency State aktif → risiko overfilling!
 *
 * Topic MQTT yang disubscribe:
 *   tambak/<node_id>/sensor/vibration
 *   Payload: { vibration: boolean, intensity: float, timestamp: string }
 *
 * Emergency State Flag:
 *   Jika aktif, sistem:
 *   1. Mencatat ke tabel alert_logs dengan level 'failsafe'
 *   2. Mengirim Telegram Emergency dengan prioritas maksimum
 *   3. Emit WebSocket event 'system:emergency'
 *   4. Memblokir perintah pengisian air (OPEN_FILL_VALVE) sampai direset manual
 *
 * Reset:
 *   Emergency state direset HANYA jika:
 *   - Admin mengkonfirmasi manual via API: POST /api/actuator/emergency/reset
 *   - Getaran benar-benar berhenti dan diverifikasi oleh operator
 */

const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Waktu tunggu verifikasi setelah PUMP_ENGINE_STOP dikirim (ms) */
const FAILSAFE_VERIFY_WINDOW_MS = parseInt(
  process.env.FAILSAFE_VERIFY_WINDOW_MS || '15000', 10  // 15 detik
);

/** Ambang batas intensitas getaran yang dianggap "masih bergetar" */
const VIBRATION_THRESHOLD = parseFloat(process.env.VIBRATION_THRESHOLD || '0.3');

/** Cooldown notifikasi emergency agar tidak spam (ms) */
const EMERGENCY_NOTIFY_COOLDOWN_MS = 2 * 60 * 1000; // 2 menit

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * State per device:
 * {
 *   [deviceId]: {
 *     engineStopPending    : boolean,   // Menunggu konfirmasi berhenti
 *     engineStopSentAt     : number,    // Timestamp PUMP_ENGINE_STOP dikirim
 *     engineStopCommandId  : number,    // ID actuator_log command
 *     emergencyActive      : boolean,   // Flag emergency state aktif
 *     emergencyActivatedAt : number,    // Timestamp emergency aktif
 *     lastVibratingAt      : number,    // Timestamp terakhir getaran terdeteksi
 *     lastNotifiedAt       : number,    // Timestamp notifikasi terakhir
 *   }
 * }
 */
const deviceStates = new Map();

/**
 * Inisialisasi state untuk device baru.
 * @param {number} deviceId
 */
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

/**
 * Ambil state device saat ini.
 * @param {number} deviceId
 * @returns {object}
 */
function getDeviceState(deviceId) {
  return deviceStates.get(deviceId) || initDeviceState(deviceId);
}

/**
 * Apakah Emergency State aktif untuk device ini?
 * Digunakan oleh actuatorController untuk memblokir OPEN_FILL_VALVE.
 * @param {number} deviceId
 * @returns {boolean}
 */
function isEmergencyActive(deviceId) {
  const state = deviceStates.get(deviceId);
  return state ? state.emergencyActive : false;
}

/**
 * Tandai bahwa PUMP_ENGINE_STOP telah dikirim ke device.
 * Mulai jendela verifikasi failsafe.
 * @param {number} deviceId
 * @param {number} commandId - ID dari actuator_logs
 */
function markEngineStopSent(deviceId, commandId) {
  const state = initDeviceState(deviceId);
  state.engineStopPending   = true;
  state.engineStopSentAt    = Date.now();
  state.engineStopCommandId = commandId;
  console.log(`[Failsafe] Engine stop sent for device ${deviceId}, command_id=${commandId}. Monitoring vibration for ${FAILSAFE_VERIFY_WINDOW_MS / 1000}s...`);
}

/**
 * Reset emergency state setelah konfirmasi manual admin.
 * @param {number} deviceId
 */
function resetEmergencyState(deviceId) {
  const state = getDeviceState(deviceId);
  state.emergencyActive      = false;
  state.emergencyActivatedAt = null;
  state.engineStopPending    = false;
  state.engineStopSentAt     = null;
  state.engineStopCommandId  = null;
  console.log(`[Failsafe] Emergency state RESET for device ${deviceId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Failsafe Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Proses pembacaan sensor getaran SW-420 dari MQTT.
 * Dipanggil dari mqtt.js ketika topik tambak/+/sensor/vibration diterima.
 *
 * @param {object} opts
 * @param {number} opts.deviceId     - Internal DB device ID
 * @param {string} opts.nodeId       - Hardware node ID
 * @param {object} opts.payload      - { vibration: boolean, intensity: float }
 * @param {object} opts.io           - Socket.io instance
 * @param {object} opts.telegramFns  - { sendEmergencyAlert }
 * @param {object} opts.mqttClient   - MQTT client instance
 */
async function handleVibrationData({ deviceId, nodeId, payload, io, telegramFns, mqttClient }) {
  const state       = initDeviceState(deviceId);
  const isVibrating = payload.vibration === true ||
                      (typeof payload.intensity === 'number' && payload.intensity >= VIBRATION_THRESHOLD);

  if (isVibrating) {
    state.lastVibratingAt = Date.now();
  }

  // ── Tidak dalam mode verifikasi — catat saja ─────────────────────────────
  if (!state.engineStopPending) {
    // Update status mesin di frontend jika getaran diterima
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

  // ── Dalam mode verifikasi pasca PUMP_ENGINE_STOP ──────────────────────────
  const elapsed = Date.now() - state.engineStopSentAt;

  if (!isVibrating) {
    // ── Mesin berhasil berhenti — verifikasi sukses ───────────────────────
    if (elapsed >= 2000) { // Minimal 2 detik tenang sebelum konfirmasi
      state.engineStopPending = false;
      console.log(`[Failsafe] ✓ Engine STOPPED confirmed for device ${deviceId} (elapsed: ${elapsed}ms)`);

      // Update actuator_log status → executed
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

  // ── Masih bergetar setelah window verifikasi → FAILSAFE AKTIF ────────────
  if (elapsed >= FAILSAFE_VERIFY_WINDOW_MS && isVibrating) {
    state.engineStopPending = false; // Hentikan monitoring

    if (state.emergencyActive) {
      // Sudah dalam emergency — throttle notifikasi
      const timeSinceLastNotify = Date.now() - (state.lastNotifiedAt || 0);
      if (timeSinceLastNotify < EMERGENCY_NOTIFY_COOLDOWN_MS) return;
    }

    // ── Aktifkan Emergency State ──────────────────────────────────────────
    state.emergencyActive      = true;
    state.emergencyActivatedAt = Date.now();
    state.lastNotifiedAt       = Date.now();

    console.error(`[Failsafe] 🆘 EMERGENCY STATE ACTIVATED for device ${deviceId} (${nodeId}) — engine still vibrating after STOP command!`);

    // ── Kirim EMERGENCY_STOP sebagai perintah cadangan ──────────────────
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(
        `tambak/${nodeId}/actuator/command`,
        JSON.stringify({ aksi: 'EMERGENCY_STOP', command_id: null }),
        { qos: 2 }
      );
    }

    // ── Catat ke alert_logs ──────────────────────────────────────────────
    const emergencyMsg = `🆘 FAILSAFE DARURAT: Mesin diesel pada node ${nodeId} gagal mati setelah perintah PUMP_ENGINE_STOP! Risiko LUAPAN AIR (overfilling). Segera periksa secara fisik!`;

    try {
      const pool = db.getPool();
      await pool.execute(
        `INSERT INTO alert_logs
           (device_id, parameter, measured_value, threshold_min, threshold_max, level_peringatan, pesan_notifikasi)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [deviceId, 'vibration_failsafe', payload.intensity ?? 1, 0, VIBRATION_THRESHOLD, 'failsafe', emergencyMsg]
      );

      // Tandai actuator_log sebagai failed
      if (state.engineStopCommandId) {
        await pool.execute(
          'UPDATE actuator_logs SET status = ?, trigger_detail = ? WHERE id = ?',
          ['failed', `FAILSAFE: Engine still vibrating after ${elapsed}ms`, state.engineStopCommandId]
        );
      }
    } catch (dbErr) {
      console.error('[Failsafe] Failed to write emergency alert to DB:', dbErr.message);
    }

    // ── Broadcast emergency ke semua klien WebSocket ─────────────────────
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

    // ── Kirim notifikasi Telegram Emergency ──────────────────────────────
    if (telegramFns?.sendEmergencyAlert) {
      telegramFns.sendEmergencyAlert({
        node_id : nodeId,
        message : emergencyMsg,
      }).catch(console.error);
    }
  }
}

/**
 * Ambil snapshot semua emergency states saat ini.
 * Digunakan oleh endpoint GET /api/actuator/emergency/status.
 * @returns {Array<object>}
 */
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
  isEmergencyActive,
  getAllEmergencyStates,
  getDeviceState,
  FAILSAFE_VERIFY_WINDOW_MS,
  VIBRATION_THRESHOLD,
};
