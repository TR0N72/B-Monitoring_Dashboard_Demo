'use strict';
/**
 * actuatorController.js — Logika Kontrol Aktuator Closed-Loop
 * ============================================================
 * Modul ini mengimplementasikan logika otomasi siklus tertutup (closed-loop)
 * untuk mengontrol aktuator tambak bandeng berdasarkan keputusan DSS Fuzzy
 * dan pembacaan nilai sensor fisik.
 *
 * Diagram alir (Closed-Loop):
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  Data Sensor MQTT (suhu, salinitas, visual_label)           │
 *  │           ↓                                                 │
 *  │  DSS Fuzzy → Skor & Rekomendasi                             │
 *  │           ↓                                                 │
 *  │  [Aman]      → Tidak ada aksi                               │
 *  │  [Waspada]   → Notifikasi Telegram (Caution), aktifkan      │
 *  │                monitoring intensif                          │
 *  │  [Bahaya]    → Sequence otomatis:                           │
 *  │    1. PUMP_ENGINE_STOP  → Hentikan pompa diesel             │
 *  │    2. (verifikasi SW-420, 15 dtk) → Konfirmasi mesin mati   │
 *  │    3. OPEN_DRAIN_VALVE  → Buka katup kuras                  │
 *  │    4. (delay 30 dtk)   → Estimasi air turun ~10 cm          │
 *  │    5. CLOSE_DRAIN_VALVE → Tutup katup kuras                 │
 *  │    6. OPEN_FILL_VALVE   → Buka katup pengisian air bersih   │
 *  │    7. (delay 30 dtk)   → Estimasi air naik ~3 cm            │
 *  │    8. CLOSE_FILL_VALVE  → Tutup katup pengisian             │
 *  └─────────────────────────────────────────────────────────────┘
 *
 * Setiap aksi dicatat ke tabel actuator_logs dan dikirim via MQTT
 * ke topik: tambak/<node_id>/actuator/command
 *
 * Anti-Spam Cooldown:
 *   Aktuator tidak akan dipicu ulang jika dalam cooldown window
 *   (default: 10 menit per device) untuk menghindari perintah berulang.
 */

const db = require('../config/db');
const tq = require('../config/telegramQueue');
const { isEmergencyActive, markEngineStopSent, FAILSAFE_VERIFY_WINDOW_MS } = require('./emergencyState');

// ─────────────────────────────────────────────────────────────────────────────
// Constants & State
// ─────────────────────────────────────────────────────────────────────────────

/** Nama-nama aksi aktuator — sama persis dengan yang dikirim ke ESP32 */
const ACTUATOR_ACTIONS = {
  OPEN_DRAIN_VALVE  : 'OPEN_DRAIN_VALVE',    // Buka katup kuras
  CLOSE_DRAIN_VALVE : 'CLOSE_DRAIN_VALVE',   // Tutup katup kuras
  OPEN_FILL_VALVE   : 'OPEN_FILL_VALVE',     // Buka katup pengisian air bersih
  CLOSE_FILL_VALVE  : 'CLOSE_FILL_VALVE',    // Tutup katup pengisian
  PUMP_ENGINE_START : 'PUMP_ENGINE_START',   // Nyalakan pompa sirkulasi
  PUMP_ENGINE_STOP  : 'PUMP_ENGINE_STOP',    // Matikan pompa diesel
  EMERGENCY_STOP    : 'EMERGENCY_STOP',      // Hentikan semua sistem (darurat)
};

/** DSS Score thresholds untuk penentuan level tindakan */
const DSS_THRESHOLD_WASPADA = 36;
const DSS_THRESHOLD_BAHAYA  = 66;

/** Cooldown antar trigger otomatis per device (ms) */
const COOLDOWN_MS = parseInt(process.env.ACTUATOR_COOLDOWN_MS || '600000', 10); // 10 menit

/** Delay antar perintah dalam sequence (ms) */
const SEQUENCE_STEP_DELAY_MS = parseInt(process.env.ACTUATOR_STEP_DELAY_MS || '30000', 10); // 30 detik

/** Map cooldown: deviceId → timestamp terakhir trigger otomatis */
const closedLoopCooldowns = new Map();

/** Map abort controllers: deviceId → AbortController (sequence aktif) */
const activeAbortControllers = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Periksa apakah device masih dalam cooldown period.
 * @param {number} deviceId
 * @returns {boolean}
 */
function isInCooldown(deviceId) {
  const last = closedLoopCooldowns.get(deviceId);
  if (!last) return false;
  return (Date.now() - last) < COOLDOWN_MS;
}

/**
 * Set cooldown untuk device.
 * @param {number} deviceId
 */
function setCooldown(deviceId) {
  closedLoopCooldowns.set(deviceId, Date.now());
}

/**
 * Reset cooldown — dipanggil saat kondisi kembali Aman.
 * @param {number} deviceId
 */
function resetCooldown(deviceId) {
  closedLoopCooldowns.delete(deviceId);
}

/**
 * Kirim perintah aktuator ke node ESP32 via MQTT dan catat ke database.
 *
 * @param {object}   opts
 * @param {object}   opts.mqttClient    - MQTT client yang sudah terhubung
 * @param {number}   opts.deviceId      - Internal DB ID perangkat
 * @param {string}   opts.nodeId        - Hardware node_id (misal: ESP32-NODE-01)
 * @param {string}   opts.aksi          - Nama aksi aktuator (lihat ACTUATOR_ACTIONS)
 * @param {string}   opts.triggerSource - 'auto_dss' | 'auto_threshold' | 'failsafe' | 'manual'
 * @param {string}   opts.triggerDetail - Deskripsi penyebab trigger
 * @returns {Promise<number>} ID log yang dibuat
 */
async function dispatchActuatorCommand({ mqttClient, deviceId, nodeId, aksi, triggerSource, triggerDetail }) {
  const pool = db.getPool();

  // Simpan ke actuator_logs
  const [result] = await pool.execute(
    `INSERT INTO actuator_logs (device_id, aksi, trigger_source, trigger_detail, status)
     VALUES (?, ?, ?, ?, ?)`,
    [deviceId, aksi, triggerSource, triggerDetail, 'pending']
  );
  const commandId = result.insertId;

  // Publish ke MQTT broker → ESP32 mendengarkan topik ini
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(
      `tambak/${nodeId}/actuator/command`,
      JSON.stringify({ aksi, command_id: commandId }),
      { qos: 1 }
    );
    console.log(`[AutoActuator] ✓ Sent ${aksi} → ${nodeId} (cmd_id: ${commandId})`);
  } else {
    console.warn(`[AutoActuator] ⚠ MQTT not connected — command ${aksi} logged but NOT sent`);
    // Update status menjadi 'mqtt_offline'
    await pool.execute(
      'UPDATE actuator_logs SET status = ? WHERE id = ?',
      ['mqtt_offline', commandId]
    );
  }

  return commandId;
}

/**
 * Kirim serangkaian perintah dengan delay antar perintah.
 * Mendukung pembatalan seketika via AbortSignal.
 *
 * @param {Array<{aksi, delayAfterMs}>} steps   - Array langkah sequence
 * @param {object}                      baseOpts - Opsi dasar (mqttClient, deviceId, nodeId, triggerSource)
 */
async function executeSequence(steps, baseOpts) {
  const { onStepDispatched, signal, ...dispatchOpts } = baseOpts;
  for (let i = 0; i < steps.length; i++) {
    // Periksa abort sebelum setiap langkah
    if (signal && signal.aborted) {
      console.warn(`[AutoActuator] ⛔ Sequence aborted at step ${i + 1} (${steps[i].aksi}) for device ${dispatchOpts.deviceId}`);
      break;
    }

    const step = steps[i];
    let commandId;
    try {
      commandId = await dispatchActuatorCommand({
        ...dispatchOpts,
        aksi          : step.aksi,
        triggerDetail : step.detail || dispatchOpts.triggerDetail,
      });
      if (onStepDispatched) onStepDispatched(step.aksi, commandId);
    } catch (err) {
      console.error(`[AutoActuator] Sequence step ${i + 1} (${step.aksi}) failed:`, err.message);
    }

    // Delay yang dapat dibatalkan
    if (i < steps.length - 1 && step.delayAfterMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, step.delayAfterMs);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve(); // Lanjut ke iterasi berikutnya (akan diperiksa abort di atas)
          }, { once: true });
        }
      });
    }
  }
}

/**
 * Batalkan sequence yang sedang berjalan untuk device tertentu.
 * Dipanggil saat EMERGENCY_STOP diterima.
 * @param {number} deviceId
 */
function abortSequence(deviceId) {
  const ctrl = activeAbortControllers.get(deviceId);
  if (ctrl) {
    ctrl.abort();
    activeAbortControllers.delete(deviceId);
    console.warn(`[AutoActuator] ⛔ Sequence for device ${deviceId} forcibly aborted (EMERGENCY_STOP)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Closed-Loop Logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluasi hasil DSS Fuzzy dan putuskan apakah perlu aksi aktuator otomatis.
 * Dipanggil dari mqtt.js setelah processFuzzy() selesai.
 *
 * @param {object} opts
 * @param {object} opts.mqttClient  - Instance MQTT client aktif
 * @param {number} opts.deviceId    - Internal DB ID
 * @param {string} opts.nodeId      - Hardware node_id
 * @param {object} opts.fuzzyResult - Hasil dari processFuzzy()
 * @param {object} opts.readings    - { suhu, salinitas }
 * @param {object} opts.io          - Socket.io instance untuk broadcast
 * Notifikasi Telegram ditangani oleh telegramQueue (dynamic routing + retry).
 */
async function evaluateAndActuate({ mqttClient, deviceId, nodeId, fuzzyResult, readings, io }) {
  const score          = fuzzyResult.score;
  const recommendation = fuzzyResult.recommendation;

  // ── Level: AMAN — reset cooldown, tidak ada aksi ─────────────────────────
  if (score < DSS_THRESHOLD_WASPADA) {
    resetCooldown(deviceId);
    return;
  }

  // ── Level: WASPADA — notifikasi dini tanpa aktivasi fisik ─────────────────
  if (score >= DSS_THRESHOLD_WASPADA && score < DSS_THRESHOLD_BAHAYA) {
    if (!isInCooldown(deviceId)) {
      console.log(`[AutoActuator] WASPADA on ${nodeId} (score: ${score}) — notifying only`);

      // Dynamic routing: kirim ke pekerja device + admin via queue
      tq.sendDssAlert({
        deviceId,
        nodeId,
        dssScore      : score,
        recommendation,
        readings,
        level         : 'waspada',
      });

      if (io) {
        io.emit('system:status', {
          device_id     : deviceId,
          node_id       : nodeId,
          level         : 'waspada',
          dss_score     : score,
          recommendation,
          message       : `Status WASPADA pada node ${nodeId}. DSS Score: ${score}/100.`,
          timestamp     : new Date(),
        });
      }

      // Cooldown pendek untuk Waspada (3 menit)
      closedLoopCooldowns.set(deviceId, Date.now() - COOLDOWN_MS + 3 * 60 * 1000);
    }
    return;
  }

  // ── Level: BAHAYA — eksekusi sequence aktuator otomatis ──────────────────
  if (score >= DSS_THRESHOLD_BAHAYA) {
    if (isInCooldown(deviceId)) {
      console.log(`[AutoActuator] BAHAYA on ${nodeId} — skipping (in cooldown)`);
      return;
    }

    // ── Interlock: blokir sekuens jika Emergency State aktif (SW-420) ────────
    if (isEmergencyActive(deviceId)) {
      console.warn(`[AutoActuator] ⛔ BAHAYA on ${nodeId} — sequence BLOCKED (emergency state active). Manual reset required.`);
      return;
    }

    setCooldown(deviceId);

    const triggerDetail = `Auto trigger: DSS Score=${score}, Suhu=${readings.suhu}°C, Salinitas=${readings.salinitas}ppt, Rekomendasi=${recommendation}`;
    console.log(`[AutoActuator] 🚨 BAHAYA on ${nodeId} — executing closed-loop sequence`);

    // ── Broadcast status darurat ke frontend ─────────────────────────────
    if (io) {
      io.emit('system:status', {
        device_id  : deviceId,
        node_id    : nodeId,
        level      : 'bahaya',
        dss_score  : score,
        recommendation,
        message    : `Kondisi BAHAYA terdeteksi. Sistem mengaktifkan protokol darurat otomatis.`,
        timestamp  : new Date(),
        auto_action: true,
      });
    }

    // ── Sequence aktuator: stop engine → drain → fill ────────────────────
    // Langkah 1: Hentikan mesin diesel TERLEBIH DAHULU
    // Langkah 2 (verifikasi SW-420, FAILSAFE_VERIFY_WINDOW_MS): Konfirmasi mesin mati
    // Langkah 3: Buka katup kuras
    // Langkah 4 (setelah delay 30 dtk): Tutup katup kuras (air turun ~10 cm)
    // Langkah 5 (transisi): Buka katup pengisian air bersih
    // Langkah 6 (setelah delay 30 dtk): Tutup katup pengisian (air naik ~3 cm)
    const sequence = [
      {
        aksi        : ACTUATOR_ACTIONS.PUMP_ENGINE_STOP,
        detail      : `${triggerDetail} | Langkah 1: Hentikan pompa diesel (sebelum buka katup)`,
        delayAfterMs: FAILSAFE_VERIFY_WINDOW_MS,     // 15 detik — jeda verifikasi SW-420
      },
      {
        aksi        : ACTUATOR_ACTIONS.OPEN_DRAIN_VALVE,
        detail      : `${triggerDetail} | Langkah 2: Buka katup kuras`,
        delayAfterMs: SEQUENCE_STEP_DELAY_MS,        // 30 detik — estimasi air turun 10 cm
      },
      {
        aksi        : ACTUATOR_ACTIONS.CLOSE_DRAIN_VALVE,
        detail      : `${triggerDetail} | Langkah 3: Tutup katup kuras (level turun ~10 cm)`,
        delayAfterMs: 5000,                           // 5 detik transisi sebelum buka isi
      },
      {
        aksi        : ACTUATOR_ACTIONS.OPEN_FILL_VALVE,
        detail      : `${triggerDetail} | Langkah 4: Buka katup pengisian air bersih`,
        delayAfterMs: SEQUENCE_STEP_DELAY_MS,        // 30 detik — estimasi air naik ~3 cm
      },
      {
        aksi        : ACTUATOR_ACTIONS.CLOSE_FILL_VALVE,
        detail      : `${triggerDetail} | Langkah 5: Tutup katup pengisian (level naik ~3 cm)`,
        delayAfterMs: 0,
      },
    ];

    // Buat AbortController baru, batalkan sequence lama jika ada
    abortSequence(deviceId);
    const abortCtrl = new AbortController();
    activeAbortControllers.set(deviceId, abortCtrl);

    // Jalankan sequence secara asinkron (tidak memblokir MQTT handler)
    executeSequence(sequence, {
      mqttClient,
      deviceId,
      nodeId,
      triggerSource    : 'auto_dss',
      signal           : abortCtrl.signal,
      onStepDispatched : (aksi, commandId) => {
        if (aksi === ACTUATOR_ACTIONS.PUMP_ENGINE_STOP) {
          markEngineStopSent(deviceId, commandId);
        }
      },
    }).finally(() => {
      // Bersihkan controller setelah sequence selesai/dibatalkan
      activeAbortControllers.delete(deviceId);
    }).catch(err => {
      console.error(`[AutoActuator] Sequence execution error:`, err.message);
    });

    // ── Kirim notifikasi Telegram Bahaya — dynamic routing via queue ─────
    tq.sendDssAlert({
      deviceId,
      nodeId,
      dssScore      : score,
      recommendation,
      readings,
      level         : 'bahaya',
    });
  }
}

module.exports = {
  evaluateAndActuate,
  dispatchActuatorCommand,
  abortSequence,
  ACTUATOR_ACTIONS,
  DSS_THRESHOLD_WASPADA,
  DSS_THRESHOLD_BAHAYA,
};
