require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { initMySQL, closeMySQL } = require('./config/db');
const { initMQTT, closeMQTT } = require('./config/mqtt');
const { initSocket } = require('./socket/alerts');
const { startCycleScheduler } = require('./services/cycleScheduler');
const { startDeviceStatusSweep } = require('./services/deviceStatus');
const authRoutes = require('./routes/auth.routes');
const devicesRoutes = require('./routes/devices.routes');
const thresholdsRoutes = require('./routes/thresholds.routes');
const logsRoutes = require('./routes/logs.routes');
const sensorsRoutes = require('./routes/sensors.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const actuatorRoutes = require('./routes/actuator.routes');
const fuzzyRoutes = require('./routes/fuzzy.routes');
const usersRoutes = require('./routes/users.routes');
const aiRoutes = require('./routes/ai.routes');
const { verifyBot } = require('./config/telegram');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3002',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// ponytail: limiter in-memory per proses, pindah ke store Redis bila backend diskalakan.
app.use('/api', require('express-rate-limit')({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak permintaan.' } }));
app.use('/api/auth', authRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/config/thresholds', thresholdsRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/sensors', sensorsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/actuator', actuatorRoutes);
app.use('/api/dss', fuzzyRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/ai', aiRoutes);
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'B-Monitor API',
    timestamp: new Date().toISOString(),
  });
});
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});
async function start() {
  try {
    // MySQL wajib: migrasi startup harus selesai. Gagal 5x -> exit, Docker restart.
    for (let i = 1; ; i++) {
      try {
        await initMySQL();
        console.log('✓ MySQL connected');
        break;
      } catch (dbErr) {
        console.warn(`⚠ MySQL belum siap (${i}/5): ${dbErr.message}`);
        if (i >= 5) throw new Error('MySQL tidak tersedia setelah 5 percobaan');
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    initMQTT().then(() => {}).catch((err) => {
      console.warn('⚠ MQTT not available:', err.message);
    });
    initSocket(server);
    startCycleScheduler();
    startDeviceStatusSweep();
    console.log('✓ Socket.io initialized');
    verifyBot().catch(() => {});
    server.listen(PORT, () => {
      console.log(`\n🐟 B-Monitor API running on http://localhost:${PORT}`);
      console.log(`   Health check: http://localhost:${PORT}/api/health\n`);
    });
  } catch (err) {
    console.error('✗ Failed to start server:', err.message);
    process.exit(1);
  }
}
async function shutdown() {
  console.log('\n⏻ Shutting down gracefully...');
  await closeMQTT();
  await closeMySQL();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
start();