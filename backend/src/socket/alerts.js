const { Server } = require('socket.io');
const { sendTelegramAlert } = require('../config/telegram');

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    path: '/ws',
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
  getConnectedClients,
};
