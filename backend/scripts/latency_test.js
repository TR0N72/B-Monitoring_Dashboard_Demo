const mqtt = require('mqtt');
const io = require('socket.io-client');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const MQTT_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const API_URL = process.env.API_URL || 'http://localhost:3001';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

console.log('=============================================');
console.log(' B-Monitor Latency Tester (MQTT -> WS & Telegram)');
console.log('=============================================');

async function testTelegramLatency() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠ Skipping Telegram latency test (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set)');
    return;
  }
  
  console.log('Mulai menguji Latensi Telegram API...');
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const startTime = Date.now();
  
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: '⏱ Latency Test Message from B-Monitor',
    });
    const latency = Date.now() - startTime;
    console.log(`✓ Telegram Latency: ${latency}ms (Target: < 5000ms)`);
    if (latency < 5000) {
      console.log('  -> LULUS (Passed)');
    } else {
      console.log('  -> GAGAL (Failed)');
    }
  } catch (err) {
    console.log(`✗ Gagal mengirim pesan ke Telegram: ${err.message}`);
  }
}

function testMQTTtoWSTLatency() {
  return new Promise((resolve) => {
    console.log('\nMulai menguji Latensi MQTT -> Node.js -> WebSocket...');
    const mqttClient = mqtt.connect(MQTT_URL);
    const socket = io(API_URL);
    
    let startTime;
    
    socket.on('connect', () => {
      console.log('✓ WebSocket Terhubung');
      
      mqttClient.on('connect', () => {
        console.log('✓ MQTT Terhubung. Mengirim payload dummy...');
        
        // Data pemicu alert (suhu sangat tinggi)
        const payload = {
          node_id: 'INTEGRATION-NODE-01',
          suhu: 40.0,
          salinitas: 15.0
        };
        
        startTime = Date.now();
        mqttClient.publish('tambak/sensor/data', JSON.stringify(payload));
      });
    });

    socket.on('new_alert', (data) => {
      const latency = Date.now() - startTime;
      console.log(`✓ Node.js Processing + WS Latency: ${latency}ms`);
      
      mqttClient.end();
      socket.disconnect();
      resolve();
    });

    setTimeout(() => {
      console.log('✗ Timeout: Tidak menerima alert dari WebSocket dalam 10 detik.');
      mqttClient.end();
      socket.disconnect();
      resolve();
    }, 10000);
  });
}

async function runTests() {
  await testTelegramLatency();
  await testMQTTtoWSTLatency();
  console.log('\nTes selesai.');
  process.exit(0);
}

runTests();
