const { Server } = require('socket.io');
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
    socket.on('acknowledge_alert', (data) => {
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
function broadcastAlert(alertData) {
  if (!io) {
    console.warn('[WS] Socket.io not initialized, alert not broadcast');
    return;
  }
  io.to('alerts').emit('new_alert', {
    ...alertData,
    timestamp: new Date().toISOString(),
  });
  console.log(`[WS] Alert broadcast: ${alertData.level_peringatan} — ${alertData.pesan_notifikasi}`);
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
module.exports = {
  initSocket,
  broadcastAlert,
  broadcastDeviceStatus,
  getIO,
};
