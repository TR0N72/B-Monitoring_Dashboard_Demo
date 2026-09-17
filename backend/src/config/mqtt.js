'use strict';
/**
 * mqtt.js — MQTT Client & Data Ingestion Pipeline
 * ================================================
 * Menangani koneksi ke Eclipse Mosquitto broker, subscribe topik telemetri,
 * memproses payload sensor, menjalankan DSS Fuzzy, dan mengeksekusi aktuator
 * closed-loop secara otomatis.
 *
 * Topik yang disubscribe:
 *   tambak/+/sensor              — Data telemetri utama (suhu, salinitas, dll.)
 *   tambak/+/actuator/status     — Konfirmasi eksekusi perintah dari ESP32
 *   tambak/+/sensor/vibration    — Pembacaan sensor getar SW-420 (Failsafe)
 */

const mqtt = require('mqtt');
const db   = require('./db');
const { evaluateAndActuate, dispatchActuatorCommand, ACTUATOR_ACTIONS } = require('../services/actuatorController');
const { handleVibrationData, markEngineStopSent }                       = require('../services/emergencyState');
const { sendTelegramAlert, sendEmergencyAlert }                         = require('./telegram');

let client = null;

// ── Node ID cache untuk menghindari query DB berulang ────────────────────────
const nodeIdCache    = new Map();
const NODE_CACHE_TTL = 5 * 60 * 1000;

async function resolveNodeId(connection, nodeId) {
  const cached = nodeIdCache.get(nodeId);
  if (cached && (Date.now() - cached.cachedAt) < NODE_CACHE_TTL) {
    return cached.internalId;
  }
  const [devices] = await connection.execute('SELECT id FROM devices WHERE node_id = ?', [nodeId]);
  if (devices.length === 0) return null;
  const internalId = devices[0].id;
  nodeIdCache.set(nodeId, { internalId, cachedAt: Date.now() });
  return internalId;
}

// ─────────────────────────────────────────────────────────────────────────────
// MQTT Initialization
// ─────────────────────────────────────────────────────────────────────────────
function initMQTT() {
  return new Promise((resolve) => {
    const host     = process.env.MQTT_HOST || 'mqtt://localhost';
    const port     = process.env.MQTT_PORT || 1883;
    const username = process.env.MQTT_USER || 'admin';
    const password = process.env.MQTT_PASSWORD || 'admin';

    client = mqtt.connect(`${host}:${port}`, {
      username,
      password,
      clientId      : `bmonitor_backend_${Math.random().toString(16).substr(2, 8)}`,
      reconnectPeriod: 5000,
    });

    client.on('connect', () => {
      console.log('✓ Connected to MQTT Broker');

      const topics = [
        'tambak/+/sensor',
        'tambak/+/actuator/status',
        'tambak/+/sensor/vibration',
      ];

      topics.forEach(topic => {
        client.subscribe(topic, (err) => {
          if (err) console.error(`✗ Subscribe failed [${topic}]:`, err.message);
          else     console.log(`✓ Subscribed to ${topic}`);
        });
      });

      resolve(client);
    });

    client.on('error', (err) => {
      console.error('✗ MQTT Error:', err.message);
    });

    client.on('message', async (topic, message) => {
      try {
        const payload    = JSON.parse(message.toString());
        const parts      = topic.split('/');
        const nodeId     = parts[1];
        const msgType    = parts[2];
        const msgSubtype = parts[3];

        if (msgType === 'sensor' && msgSubtype === 'vibration') {
          await handleVibrationMessage(nodeId, payload);
        } else if (msgType === 'sensor') {
          await handleSensorData(nodeId, payload);
        } else if (msgType === 'actuator' && msgSubtype === 'status') {
          await handleActuatorStatus(nodeId, payload);
        }
      } catch (err) {
        console.error('[MQTT] Message processing error:', err.message);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: Data Sensor Utama (suhu, salinitas, baterai, rssi)
// ─────────────────────────────────────────────────────────────────────────────
async function handleSensorData(nodeId, payload) {
  try {
    const pool       = db.getPool();
    const connection = await pool.getConnection();
    try {
      const internalId = await resolveNodeId(connection, nodeId);
      if (internalId === null) return;

      await connection.execute(
        'UPDATE devices SET last_seen = NOW(), status = "online" WHERE id = ?',
        [internalId]
      );

      const suhu      = payload.suhu      ?? null;
      const salinitas = payload.salinitas ?? null;
      const baterai   = payload.baterai   ?? null;
      const rssi      = payload.rssi      ?? null;

      const [insertResult] = await connection.execute(
        'INSERT INTO sensor_data (device_id, suhu, salinitas, baterai, rssi) VALUES (?, ?, ?, ?, ?)',
        [internalId, suhu, salinitas, baterai, rssi]
      );
      const sensorDataId = insertResult.insertId;

      // ── DSS Fuzzy + Closed-Loop Actuator ──────────────────────────────
      if (suhu !== null && salinitas !== null) {
        const { processFuzzy } = require('../services/fuzzyDSS');
        const fuzzyResult = processFuzzy(suhu, salinitas);

        await connection.execute(
          `INSERT INTO fuzzy_decisions
             (device_id, sensor_data_id, suhu_membership, salinitas_membership,
              visual_label, dss_score, dss_recommendation, fired_rules)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            internalId,
            sensorDataId,
            fuzzyResult.suhu_membership,
            fuzzyResult.salinitas_membership,
            fuzzyResult.visual_label,
            fuzzyResult.score,
            fuzzyResult.recommendation,
            JSON.stringify(fuzzyResult.fired_rules),
          ]
        );

        const { getIo } = require('../socket/alerts');
        const io = getIo();

        if (io) {
          io.emit('dss:update', {
            device_id : internalId,
            node_id   : nodeId,
            ...fuzzyResult,
            created_at: new Date(),
          });
        }

        // ── CLOSED-LOOP: Evaluasi DSS dan eksekusi aktuator jika perlu ──
        await evaluateAndActuate({
          mqttClient  : client,
          deviceId    : internalId,
          nodeId,
          fuzzyResult,
          readings    : { suhu, salinitas },
          io,
        });
      }

      // ── Cek threshold statis dan kirim alert ──────────────────────────
      await checkThresholds(connection, internalId, sensorDataId, { suhu, salinitas }, nodeId);

    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('[MQTT] handleSensorData error:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: Sensor Getaran SW-420 (Failsafe)
// ─────────────────────────────────────────────────────────────────────────────
async function handleVibrationMessage(nodeId, payload) {
  try {
    const pool       = db.getPool();
    const connection = await pool.getConnection();
    try {
      const internalId = await resolveNodeId(connection, nodeId);
      if (internalId === null) return;
    } finally {
      connection.release();
    }

    // Dapatkan internalId lagi untuk digunakan di luar blok connection
    const pool2      = db.getPool();
    const [[device]] = await pool2.execute('SELECT id FROM devices WHERE node_id = ?', [nodeId]);
    if (!device) return;

    const { getIo } = require('../socket/alerts');
    const io = getIo();

    await handleVibrationData({
      deviceId   : device.id,
      nodeId,
      payload,
      io,
      mqttClient : client,
    });

  } catch (err) {
    console.error('[MQTT] handleVibrationMessage error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluasi Threshold Statis
// ─────────────────────────────────────────────────────────────────────────────
async function checkThresholds(connection, deviceId, sensorDataId, readings, nodeId) {
  try {
    const [thresholds] = await connection.execute(
      'SELECT parameter, batas_bawah, batas_atas FROM threshold_config WHERE device_id = ?',
      [deviceId]
    );

    for (const t of thresholds) {
      const value = readings[t.parameter];
      if (value === undefined || value === null) continue;

      const min   = parseFloat(t.batas_bawah);
      const max   = parseFloat(t.batas_atas);

      if (value < min || value > max) {
        const level = (value < min * 0.8 || value > max * 1.2) ? 'critical' : 'warning';
        const msg   = `Parameter ${t.parameter} di luar batas aman: ${value} (Batas: ${min} – ${max})`;

        await connection.execute(
          `INSERT INTO alert_logs
             (device_id, sensor_data_id, parameter, measured_value, threshold_min, threshold_max,
              level_peringatan, pesan_notifikasi)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [deviceId, sensorDataId, t.parameter, value, min, max, level, msg]
        );

        sendTelegramAlert({
          device_id       : deviceId,
          node_id         : nodeId,
          parameter       : t.parameter,
          measured_value  : value,
          threshold_min   : min,
          threshold_max   : max,
          level_peringatan: level,
          pesan_notifikasi: msg,
        });

      }
    }
  } catch (err) {
    console.error('[MQTT] checkThresholds error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: Konfirmasi Status Aktuator dari ESP32
// ─────────────────────────────────────────────────────────────────────────────
async function handleActuatorStatus(nodeId, payload) {
  try {
    const pool       = db.getPool();
    const connection = await pool.getConnection();
    try {
      const internalId = await resolveNodeId(connection, nodeId);
      if (internalId === null) return;

      if (payload.command_id) {
        await connection.execute(
          'UPDATE actuator_logs SET status = ?, trigger_detail = ? WHERE id = ?',
          [payload.status || 'executed', payload.trigger_detail || null, payload.command_id]
        );
      } else {
        await connection.execute(
          'INSERT INTO actuator_logs (device_id, aksi, trigger_source, status, trigger_detail) VALUES (?, ?, ?, ?, ?)',
          [internalId, payload.aksi || 'UNKNOWN', 'edge', payload.status || 'executed', payload.trigger_detail || null]
        );
      }

      // ── Jika ini konfirmasi PUMP_ENGINE_STOP → aktifkan monitoring failsafe
      if (payload.aksi === ACTUATOR_ACTIONS.PUMP_ENGINE_STOP && payload.command_id) {
        markEngineStopSent(internalId, payload.command_id);
      }

      const { getIo } = require('../socket/alerts');
      const io = getIo();
      if (io) {
        io.emit('actuator:status', {
          device_id: internalId,
          node_id  : nodeId,
          ...payload,
        });
      }
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('[MQTT] handleActuatorStatus error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Publish Helper
// ─────────────────────────────────────────────────────────────────────────────
function publishMQTT(topic, message, options = {}) {
  if (client && client.connected) {
    client.publish(topic, JSON.stringify(message), { qos: options.qos || 0 });
  } else {
    console.warn('[MQTT] Client not connected — cannot publish.');
  }
}

function closeMQTT() {
  return new Promise((resolve) => {
    if (client) {
      client.end(false, () => resolve());
    } else {
      resolve();
    }
  });
}

module.exports = {
  initMQTT,
  closeMQTT,
  publishMQTT,
};
