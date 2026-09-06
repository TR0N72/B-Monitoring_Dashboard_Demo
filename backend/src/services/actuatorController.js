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
 *  │    1. OPEN_DRAIN_VALVE  → Buka katup kuras                  │
 *  │    2. Monitor level air → 10 cm turun (timer)               │
 *  │    3. CLOSE_DRAIN_VALVE → Tutup katup kuras                 │
 *  │    4. OPEN_FILL_VALVE   → Buka katup pengisian              │
 *  │    5. PUMP_ENGINE_STOP  → Hentikan pompa diesel             │
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
 * Digunakan untuk sequence multi-langkah.
 *
 * @param {Array<{aksi, delayAfterMs}>} steps   - Array langkah sequence
 * @param {object}                      baseOpts - Opsi dasar (mqttClient, deviceId, nodeId, triggerSource)
 */
async function executeSequence(steps, baseOpts) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      await dispatchActuatorCommand({
        ...baseOpts,
        aksi          : step.aksi,
        triggerDetail : step.detail || baseOpts.triggerDetail,
      });
    } catch (err) {
      console.error(`[AutoActuator] Sequence step ${i + 1} (${step.aksi}) failed:`, err.message);
    }

    // Tunggu sebelum mengirim langkah berikutnya
    if (i < steps.length - 1 && step.delayAfterMs > 0) {
      await new Promise(r => setTimeout(r, step.delayAfterMs));
    }
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

    // ── Sequence aktuator: drain → fill → stop engine ────────────────────
    // Langkah 1: Buka katup kuras
    // Langkah 2 (setelah delay): Tutup katup kuras (air turun ~10 cm)
    // Langkah 3: Buka katup pengisian air bersih
    // Langkah 4: Hentikan mesin pompa diesel
    const sequence = [
      {
        aksi        : ACTUATOR_ACTIONS.OPEN_DRAIN_VALVE,
        detail      : `${triggerDetail} | Langkah 1: Buka katup kuras`,
        delayAfterMs: SEQUENCE_STEP_DELAY_MS,        // 30 detik — estimasi air turun 10 cm
      },
      {
        aksi        : ACTUATOR_ACTIONS.CLOSE_DRAIN_VALVE,
        detail      : `${triggerDetail} | Langkah 2: Tutup katup kuras (level turun ~10 cm)`,
        delayAfterMs: 5000,                           // 5 detik transisi
      },
      {
        aksi        : ACTUATOR_ACTIONS.OPEN_FILL_VALVE,
        detail      : `${triggerDetail} | Langkah 3: Buka katup pengisian air bersih`,
        delayAfterMs: 5000,
      },
      {
        aksi        : ACTUATOR_ACTIONS.PUMP_ENGINE_STOP,
        detail      : `${triggerDetail} | Langkah 4: Auto Engine Stop — hentikan pompa diesel`,
        delayAfterMs: 0,
      },
    ];

    // Jalankan sequence secara asinkron (tidak memblokir MQTT handler)
    executeSequence(sequence, {
      mqttClient,
      deviceId,
      nodeId,
      triggerSource: 'auto_dss',
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
  ACTUATOR_ACTIONS,
  DSS_THRESHOLD_WASPADA,
  DSS_THRESHOLD_BAHAYA,
};
