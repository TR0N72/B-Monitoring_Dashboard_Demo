require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { initMySQL, closeMySQL } = require('./config/db');
const { initRabbitMQ, closeRabbitMQ } = require('./config/rabbitmq');
const { initSocket } = require('./socket/alerts');
const authRoutes = require('./routes/auth.routes');
const devicesRoutes = require('./routes/devices.routes');
const thresholdsRoutes = require('./routes/thresholds.routes');
const logsRoutes = require('./routes/logs.routes');
const sensorsRoutes = require('./routes/sensors.routes');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/auth', authRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/config/thresholds', thresholdsRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/sensors', sensorsRoutes);
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
    await initMySQL();
    console.log('✓ MySQL connected');
    initRabbitMQ().then(() => {
      console.log('✓ RabbitMQ connected');
    }).catch((err) => {
      console.warn('⚠ RabbitMQ not available (will retry):', err.message);
    });
    initSocket(server);
    console.log('✓ Socket.io initialized');
    server.listen(PORT, () => {
      console.log(`\n🐟 B-Monitor API running on http:
      console.log(`   Health check: http:
    });
  } catch (err) {
    console.error('✗ Failed to start server:', err.message);
    process.exit(1);
  }
}
async function shutdown() {
  console.log('\n⏻ Shutting down gracefully...');
  await closeRabbitMQ();
  await closeMySQL();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
start();
