'use strict';
// Hardware simulator. Publishes the telemetry contract to tambak/{node}/sensor.
// Usage: node scripts/sim_node.js [node_id] [count=5] [interval_ms=2000] [normal|hot|anomaly]
// Run from backend/ (needs mqtt, dotenv) or set NODE_PATH=backend/node_modules.
const mqtt = require('mqtt');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const [node = 'ESP32-NODE-01', count = '5', gap = '2000', mode = 'normal'] = process.argv.slice(2);
const r = (a, b) => +(a + Math.random() * (b - a)).toFixed(2);
const profiles = {
  normal: () => ({ suhu: r(27, 30), jarak_cm: r(27, 33), salinitas: r(18, 25), kekeruhan: r(10, 40) }),
  hot: () => ({ suhu: r(36, 38), jarak_cm: r(27, 33), salinitas: r(18, 25), kekeruhan: r(10, 40) }),
  anomaly: () => ({ suhu: 99, jarak_cm: r(27, 33), salinitas: r(18, 25), kekeruhan: r(10, 40) }),
};
if (!profiles[mode]) { console.error('mode must be normal|hot|anomaly'); process.exit(1); }
const c = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883', {
  username: process.env.MQTT_USER || 'admin',
  password: process.env.MQTT_PASSWORD || 'admin',
});
c.on('error', (e) => { console.error('MQTT error:', e.message); process.exit(1); });
c.on('connect', async () => {
  for (let i = 1; i <= +count; i++) {
    const p = { ...profiles[mode](), baterai: r(60, 100), rssi: -Math.round(r(50, 80)) };
    await new Promise((ok) => c.publish(`tambak/${node}/sensor`, JSON.stringify(p), { qos: 1 }, ok));
    console.log(`[${i}/${count}] ${node}`, JSON.stringify(p));
    if (i < +count) await new Promise((ok) => setTimeout(ok, +gap));
  }
  c.end(false, () => process.exit(0));
});
