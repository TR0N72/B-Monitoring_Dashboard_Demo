const mqtt = require('mqtt');
const db = require('./db');

let client = null;

function initMQTT() {
  return new Promise((resolve, reject) => {
    const host = process.env.MQTT_HOST || 'mqtt://localhost';
    const port = process.env.MQTT_PORT || 1883;
    const username = process.env.MQTT_USER || 'admin';
    const password = process.env.MQTT_PASSWORD || 'admin';

    client = mqtt.connect(`${host}:${port}`, {
      username,
      password,
      clientId: `bmonitor_backend_${Math.random().toString(16).substr(2, 8)}`,
      reconnectPeriod: 5000,
    });

    client.on('connect', () => {
      console.log('✓ Connected to MQTT Broker');
      
      // Subscribe to sensor data: tambak/{node_id}/sensor
      client.subscribe('tambak/+/sensor', (err) => {
        if (err) {
          console.error('✗ Failed to subscribe to sensor data:', err.message);
        } else {
          console.log('✓ Subscribed to tambak/+/sensor');
        }
      });

      // Subscribe to actuator status: tambak/{node_id}/actuator/status
      client.subscribe('tambak/+/actuator/status', (err) => {
        if (err) {
          console.error('✗ Failed to subscribe to actuator status:', err.message);
        } else {
          console.log('✓ Subscribed to tambak/+/actuator/status');
        }
      });
      
      resolve(client);
    });

    client.on('error', (err) => {
      console.error('✗ MQTT Error:', err.message);
      // We do not reject the promise here immediately to allow auto-reconnect, 
      // but if initial connection fails it might be handled.
    });

    client.on('message', async (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        const topicParts = topic.split('/');
        const nodeId = topicParts[1];
        const msgType = topicParts[2]; // sensor or actuator

        if (msgType === 'sensor') {
          await handleSensorData(nodeId, payload);
        } else if (msgType === 'actuator' && topicParts[3] === 'status') {
          await handleActuatorStatus(nodeId, payload);
        }
      } catch (err) {
        console.error('Error processing MQTT message:', err.message);
      }
    });
  });
}

async function handleSensorData(nodeId, payload) {
  try {
    const connection = await db.getConnection();
    try {
      // Find internal device ID
      const [devices] = await connection.execute('SELECT id FROM devices WHERE node_id = ?', [nodeId]);
      if (devices.length === 0) return; // Unknown device

      const internalId = devices[0].id;
      
      // Update last seen
      await connection.execute('UPDATE devices SET last_seen = NOW(), status = "online" WHERE id = ?', [internalId]);

      // Insert sensor data
      const suhu = payload.suhu || null;
      const salinitas = payload.salinitas || null;
      const baterai = payload.baterai || null;
      const rssi = payload.rssi || null;

      const [insertResult] = await connection.execute(
        'INSERT INTO sensor_data (device_id, suhu, salinitas, baterai, rssi) VALUES (?, ?, ?, ?, ?)',
        [internalId, suhu, salinitas, baterai, rssi]
      );
      
      const sensorDataId = insertResult.insertId;

      // TODO: Call Fuzzy DSS engine here in Session 4
      if (suhu !== null && salinitas !== null) {
        const { processFuzzy } = require('../services/fuzzyDSS');
        const fuzzyResult = processFuzzy(suhu, salinitas);
        
        await connection.execute(
          `INSERT INTO fuzzy_decisions 
           (device_id, sensor_data_id, suhu_membership, salinitas_membership, dss_score, dss_recommendation, fired_rules) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [internalId, sensorDataId, fuzzyResult.suhu_membership, fuzzyResult.salinitas_membership, fuzzyResult.score, fuzzyResult.recommendation, JSON.stringify(fuzzyResult.fired_rules)]
        );

        const { getIo } = require('../socket/alerts');
        const io = getIo();
        if (io) {
          io.emit('dss:update', {
            device_id: internalId,
            node_id: nodeId,
            ...fuzzyResult,
            created_at: new Date()
          });
        }
      }

      // Check thresholds
      await checkThresholds(connection, internalId, sensorDataId, { suhu, salinitas });
      
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Error handling sensor data:', err);
  }
}

async function checkThresholds(connection, deviceId, sensorDataId, readings) {
  try {
    const [thresholds] = await connection.execute('SELECT parameter, batas_bawah, batas_atas FROM threshold_config WHERE device_id = ?', [deviceId]);
    
    for (const t of thresholds) {
      const param = t.parameter;
      const value = readings[param];
      
      if (value !== undefined && value !== null) {
        const min = parseFloat(t.batas_bawah);
        const max = parseFloat(t.batas_atas);
        
        if (value < min || value > max) {
          const level = (value < min * 0.8 || value > max * 1.2) ? 'critical' : 'warning';
          const msg = `Parameter ${param} di luar batas aman: ${value} (Batas: ${min} - ${max})`;
          
          await connection.execute(
            `INSERT INTO alert_logs 
             (device_id, sensor_data_id, parameter, measured_value, threshold_min, threshold_max, level_peringatan, pesan_notifikasi) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [deviceId, sensorDataId, param, value, min, max, level, msg]
          );

          // Need to send Telegram alert here
          const { sendTelegramAlert } = require('./telegram'); // lazy loaded to avoid circular deps
          sendTelegramAlert({
             device_id: deviceId, // For simplicity we send internal ID, or look up node_id if needed
             parameter: param,
             value: value,
             min: min,
             max: max,
             level: level,
             message: msg
          }).catch(console.error);
        }
      }
    }
  } catch (err) {
    console.error('Error checking thresholds:', err);
  }
}

async function handleActuatorStatus(nodeId, payload) {
  try {
    const connection = await db.getConnection();
    try {
      const [devices] = await connection.execute('SELECT id FROM devices WHERE node_id = ?', [nodeId]);
      if (devices.length === 0) return;
      const internalId = devices[0].id;

      if (payload.command_id) {
        await connection.execute('UPDATE actuator_logs SET status = ?, trigger_detail = ? WHERE id = ?', 
          [payload.status || 'executed', payload.trigger_detail || null, payload.command_id]);
      } else {
        await connection.execute('INSERT INTO actuator_logs (device_id, aksi, trigger_source, status, trigger_detail) VALUES (?, ?, ?, ?, ?)',
          [internalId, payload.aksi || 'UNKNOWN', 'edge', payload.status || 'executed', payload.trigger_detail || null]);
      }

      const { getIo } = require('../socket/alerts');
      const io = getIo();
      if (io) {
        io.emit('actuator:status', {
          device_id: internalId,
          node_id: nodeId,
          ...payload
        });
      }
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Error handling actuator status:', err);
  }
}

function publishMQTT(topic, message) {
  if (client && client.connected) {
    client.publish(topic, JSON.stringify(message));
  } else {
    console.warn('MQTT Client not connected, cannot publish.');
  }
}

function closeMQTT() {
  return new Promise((resolve) => {
    if (client) {
      client.end(false, () => {
        resolve();
      });
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
