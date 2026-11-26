'use strict';

const mqtt = require('mqtt');
const db   = require('./db');
const { evaluateAndActuate, ACTUATOR_ACTIONS } = require('../services/actuatorController');
const { handleVibrationData, markEngineStopSent }                       = require('../services/emergencyState');
const { sendTelegramAlert }                                              = require('./telegram');

let client = null;

// Alert cooldown is centralized in telegramQueue.js (ALERT_COOLDOWN_MS).
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
        'tambak/+/camera/result',
        'tambak/+/vision',
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
        } else if (msgType === 'camera' && msgSubtype === 'result') {
          await require('../services/aiDetection').saveDetection({ ...payload, node_id: nodeId });
        } else if (msgType === 'vision' && !msgSubtype) {
          // Hardware vision payload: node comes from topic and backend assigns timestamp.
          await require('../services/aiDetection').saveDetection({
            node_id: nodeId, label: payload.kondisi, confidence: payload.confidence,
            model_version: 'hw-vision', hsv_metadata: { predicted_class: payload.kelas == null ? null : String(payload.kelas).slice(0, 40), source: 'mqtt' },
          });
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

// Preserve out-of-range numbers so anomaly alerts and hardware failure detection still trigger.
function sanitizeFloat(value, min = -Infinity, max = Infinity, onAnomaly = null) {
  const n = parseFloat(value);
  if (!isFinite(n)) return null;

  if (n < min || n > max) {
    if (typeof onAnomaly === 'function') {
      onAnomaly(n, min, max);
    }
    return n;
  }

  return n;
}

async function handleSensorData(nodeId, payload) {
  try {
    const pool       = db.getPool();
    const connection = await pool.getConnection();
    try {
      const internalId = await resolveNodeId(connection, nodeId);
      if (internalId === null) return;

      await connection.execute(
        'UPDATE devices SET last_seen = NOW(), status = IF(status = "maintenance", "maintenance", "online") WHERE id = ?',
        [internalId]
      );

      const anomalies = [];
      const recordAnomaly = (param, val, min, max) => {
        anomalies.push({
          parameter       : param,
          measured_value  : val,
          threshold_min   : min,
          threshold_max   : max,
          level_peringatan: 'critical',
          pesan_notifikasi: `🚨 [Sensor Anomaly / Hardware Failure] Pembacaan ekstrem pada node ${nodeId}: ${param} = ${val} (rentang wajar: ${min}–${max}). Periksa fisik sensor dan jalur kabel.`,
        });
      };

      const suhu      = sanitizeFloat(payload.suhu,      0,   45, (v, min, max) => recordAnomaly('suhu', v, min, max));
      if (payload.ph !== undefined) console.warn(`[MQTT] ${nodeId}: field "ph" diabaikan (sensor pH tidak dipakai)`);
      let   salinitas = sanitizeFloat(payload.salinitas ?? payload.sal_ppt, 0,  100, (v, min, max) => recordAnomaly('salinitas', v, min, max));
      const turbidity = sanitizeFloat(payload.kekeruhan, 0, 1000, (v, min, max) => recordAnomaly('turbidity', v, min, max));
      const baterai   = sanitizeFloat(payload.baterai,   0,  100, (v, min, max) => recordAnomaly('baterai', v, min, max));
      const rssi      = sanitizeFloat(payload.rssi,   -150,    0, (v, min, max) => recordAnomaly('rssi', v, min, max));

      const siklus   = ['IDLE', 'FILL', 'SETTLE', 'MEASURE', 'DRAIN'].includes(payload.status) ? payload.status : null;
      const seq      = Number.isInteger(payload.seq) ? payload.seq : null;
      const adc      = Number.isInteger(payload.adc) ? payload.adc : null;
      const jarak_cm = sanitizeFloat(payload.jarak_cm, 0, 1000);
      // Salinity is final only in IDLE/DRAIN; intermediate cycle states are stored without triggering DSS or alerts.
      const isFinal  = siklus === null || siklus === 'IDLE' || siklus === 'DRAIN';

      if (suhu === null && salinitas === null && baterai === null) {
        console.warn(`[MQTT] Payload tidak valid dari node ${nodeId} — diabaikan:`, payload);
        return;
      }

      // Gateway repeats the last final salinity in IDLE/DRAIN packets; null it on repeats so it is not re-evaluated.
      if (salinitas !== null && (siklus === 'IDLE' || siklus === 'DRAIN')) {
        const [prev] = await connection.execute(
          `SELECT salinitas, siklus_status FROM sensor_data
            WHERE device_id = ? AND (salinitas IS NOT NULL OR siklus_status IN ('FILL','SETTLE','MEASURE'))
            ORDER BY id DESC LIMIT 1`,
          [internalId]
        );
        if (prev.length && ['IDLE', 'DRAIN'].includes(prev[0].siklus_status)
            && prev[0].salinitas !== null && Math.abs(Number(prev[0].salinitas) - salinitas) < 1e-6) {
          salinitas = null;
        }
      }

      const [insertResult] = await connection.execute(
        'INSERT INTO sensor_data (device_id, suhu, salinitas, turbidity, baterai, rssi, seq, adc, jarak_cm, siklus_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [internalId, suhu, salinitas, turbidity, baterai, rssi, seq, adc, jarak_cm, siklus]
      );
      const sensorDataId = insertResult.insertId;

      const { getIo } = require('../socket/alerts');
      const io = getIo();
      if (io) {
        io.emit('sensor_update', {
          id: sensorDataId,
          device_id: internalId,
          node_id: nodeId,
          suhu,
          salinitas,
          turbidity,
          baterai,
          rssi,
          seq,
          jarak_cm,
          siklus_status: siklus,
          is_final: isFinal,
          recorded_at: new Date().toISOString()
        });
      }

      if (anomalies.length > 0 && isFinal) {
        const { getIo } = require('../socket/alerts');
        const io = getIo();

        for (const anom of anomalies) {
          console.warn(`[MQTT] ${anom.pesan_notifikasi}`);
          await connection.execute(
            `INSERT INTO alert_logs
               (device_id, sensor_data_id, parameter, measured_value, threshold_min, threshold_max,
                level_peringatan, pesan_notifikasi)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [internalId, sensorDataId, anom.parameter, anom.measured_value, anom.threshold_min, anom.threshold_max, anom.level_peringatan, anom.pesan_notifikasi]
          );

          if (io) {
            io.to('alerts').emit('new_alert', {
              device_id       : internalId,
              node_id         : nodeId,
              parameter       : anom.parameter,
              measured_value  : anom.measured_value,
              threshold_min   : anom.threshold_min,
              threshold_max   : anom.threshold_max,
              level_peringatan: anom.level_peringatan,
              pesan_notifikasi: anom.pesan_notifikasi,
              timestamp       : new Date().toISOString(),
            });
          }

          sendTelegramAlert({
            device_id       : internalId,
            node_id         : nodeId,
            parameter       : anom.parameter,
            measured_value  : anom.measured_value,
            threshold_min   : anom.threshold_min,
            threshold_max   : anom.threshold_max,
            level_peringatan: anom.level_peringatan,
            pesan_notifikasi: anom.pesan_notifikasi,
          });
        }
      }

      // Skip DSS and actuator automation when primary sensors report extreme hardware anomalies.
      const mainSensorAnomaly = anomalies.some(a => ['suhu', 'salinitas'].includes(a.parameter));
      if (isFinal && suhu !== null && salinitas !== null && !mainSensorAnomaly) {
        const { processFuzzy } = require('../services/fuzzyDSS');
        
        let visualLabel = payload.visual_label || payload.visualLabel;
        if (!visualLabel) {
          // Fall back to latest high-confidence AI detection within 30 min, else 'Normal'.
          const [vis] = await connection.execute(
            `SELECT label FROM ai_detection_logs WHERE device_id = ? AND confidence >= ? AND created_at >= (NOW() - INTERVAL 30 MINUTE)
             ORDER BY created_at DESC LIMIT 1`, [internalId, require('../services/aiDetection').MIN_CONFIDENCE]);
          visualLabel = vis[0]?.label || 'Normal';
        }
        const fuzzyResult = processFuzzy(suhu, salinitas, visualLabel);

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

        await evaluateAndActuate({
          mqttClient  : client,
          deviceId    : internalId,
          nodeId,
          fuzzyResult,
          readings    : { suhu, salinitas },
          io,
        });
      }

      if (isFinal) {
        await checkThresholds(connection, internalId, sensorDataId, { suhu, salinitas, turbidity }, nodeId);
      }

    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('[MQTT] handleSensorData error:', err);
  }
}

async function handleVibrationMessage(nodeId, payload) {
  try {
    const pool       = db.getPool();
    const connection = await pool.getConnection();
    let internalId   = null;
    try {
      internalId = await resolveNodeId(connection, nodeId);
    } finally {
      connection.release();
    }
    if (internalId === null) return;

    const { getIo } = require('../socket/alerts');
    const io = getIo();

    await handleVibrationData({
      deviceId   : internalId,
      nodeId,
      payload,
      io,
      mqttClient : client,
    });

  } catch (err) {
    console.error('[MQTT] handleVibrationMessage error:', err.message);
  }
}

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
          [String(payload.status || 'executed').slice(0, 20), payload.trigger_detail || payload.detail || null, payload.command_id]
        );
      } else {
        await connection.execute(
          'INSERT INTO actuator_logs (device_id, aksi, trigger_source, status, trigger_detail) VALUES (?, ?, ?, ?, ?)',
          [internalId, payload.aksi || 'UNKNOWN', 'edge', String(payload.status || 'executed').slice(0, 20), payload.trigger_detail || payload.detail || null]
        );
      }

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

// Default QoS 1 prevents dropped commands on unstable coastal networks; callers may pass qos: 2.
function publishMQTT(topic, message, options = {}) {
  if (client && client.connected) {
    client.publish(topic, JSON.stringify(message), { qos: options.qos ?? 1 });
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
