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
const { loadRevoked } = require('./services/tokenBlacklist');
const { loadPersisted } = require('./config/telegramQueue');
const { startRetention } = require('./services/retention');
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
const { dateGuard } = require('./services/dateRange');
const { errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimit');
const { loadEmergencyStates } = require('./services/emergencyState');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
// Di belakang reverse proxy (nginx dsb.) set TRUST_PROXY=1 agar req.ip & rate-limit memakai IP klien asli.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3002',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', apiLimiter);
app.use('/api', dateGuard);
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
app.use(errorHandler);
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
    await loadRevoked().then((n) => console.log(`✓ Token blacklist: ${n} entri`)).catch((e) => console.warn('⚠ Token blacklist load gagal:', e.message));
    await loadPersisted().then((n) => console.log(`✓ Antrean Telegram: ${n} pending dipulihkan`)).catch((e) => console.warn('⚠ Antrean Telegram load gagal:', e.message));
    // Failed restore starts failsafe state empty (fail-open); check logs on startup.
    await loadEmergencyStates().then((n) => console.log(`✓ Failsafe: ${n} state darurat dipulihkan`)).catch((e) => console.warn('⚠ Failsafe state load gagal:', e.message));
    initMQTT().then(() => {}).catch((err) => {
      console.warn('⚠ MQTT not available:', err.message);
    });
    initSocket(server);
    startCycleScheduler();
    startDeviceStatusSweep();
    startRetention();
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