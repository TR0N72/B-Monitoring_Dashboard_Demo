'use strict';
// AI-team simulator. Publishes a detection to tambak/{node}/camera/result (same path a real model uses).
// Usage: node scripts/sim_ai.js [node_id] [Normal|Caution|Warning] [confidence=0.9]
const mqtt = require('mqtt');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const [node = 'ESP32-NODE-01', label = 'Normal', conf = '0.9'] = process.argv.slice(2);
const c = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883', {
  username: process.env.MQTT_USER || 'admin',
  password: process.env.MQTT_PASSWORD || 'admin',
});
c.on('error', (e) => { console.error('MQTT error:', e.message); process.exit(1); });
c.on('connect', () => {
  const p = {
    label, confidence: +conf, model_version: 'SIMULATOR',
    detection_type: 'visual_classification', hsv_metadata: { h: 95, s: 0.42, v: 0.61 },
  };
  c.publish(`tambak/${node}/camera/result`, JSON.stringify(p), { qos: 1 }, () => {
    console.log('published', node, JSON.stringify(p));
    c.end(false, () => process.exit(0));
  });
});
