const { Server } = require('socket.io');
const { sendTelegramAlert } = require('../config/telegram');

let io = null;

function initSocket(httpServer) {
  const allowedOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:3002')
    .split(',')
    .map(o => o.trim());

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Izinkan request tanpa origin (seperti tools/curl) atau jika origin terdaftar
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
          callback(null, true);
        } else {
          callback(new Error('CORS origin not allowed'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    path: '/ws',
  });

  // ── Authentication Middleware pada Handshake ────────────────────────────
  io.use((socket, next) => {
    try {
      let token = null;
      const cookieHeader = socket.handshake.headers.cookie;
      if (cookieHeader) {
        const match = cookieHeader.match(/bmonitor_token=([^;]+)/);
        if (match) token = match[1];
      }
      if (!token && socket.handshake.auth?.token) {
        token = socket.handshake.auth.token;
      }
      if (!token && socket.handshake.headers.authorization) {
        const auth = socket.handshake.headers.authorization;
        if (auth.startsWith('Bearer ')) token = auth.slice(7);
      }

      // Bypass auth hanya saat testing
      if (!token && process.env.NODE_ENV === 'test') {
        socket.user = { id: 1, role: 'admin' };
        return next();
      }

      if (!token) {
        return next(new Error('Authentication error: Token required for WebSocket connection'));
      }

      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('../middleware/auth');
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);
    socket.join('alerts');

    socket.on('request_status', () => {
      socket.emit('status', {
        connected: true,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('acknowledge_alert', async (data) => {
      console.log(`[WS] Alert ${data.alertId} acknowledged by client ${socket.id}`);
      io.to('alerts').emit('alert_acknowledged', {
        alertId: data.alertId,
        acknowledgedAt: new Date().toISOString(),
      });
    });

    socket.on('disconnect', (reason) => {
      console.log(`[WS] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  return io;
}

async function broadcastAlert(alertData) {
  if (!io) {
    console.warn('[WS] Socket.io not initialized, alert not broadcast');
    return;
  }

  io.to('alerts').emit('new_alert', {
    ...alertData,
    timestamp: new Date().toISOString(),
  });

  console.log(`[WS] Alert broadcast: ${alertData.level_peringatan} — ${alertData.pesan_notifikasi}`);

  try {
    await sendTelegramAlert(alertData);
  } catch (err) {
    console.error('[WS] Telegram dispatch error:', err.message);
  }
}

function broadcastDeviceStatus(statusData) {
  if (!io) return;
  io.to('alerts').emit('device_status', {
    ...statusData,
    timestamp: new Date().toISOString(),
  });
}

function getIO() {
  return io;
}

function getConnectedClients() {
  if (!io) return 0;
  const room = io.sockets.adapter.rooms.get('alerts');
  return room ? room.size : 0;
}

module.exports = {
  initSocket,
  broadcastAlert,
  broadcastDeviceStatus,
  getIO,
  getIo: getIO,
  getConnectedClients,
};