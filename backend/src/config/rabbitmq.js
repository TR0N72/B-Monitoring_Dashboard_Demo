const amqplib = require('amqplib');
let connection = null;
let channel = null;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const SENSOR_QUEUE = process.env.RABBITMQ_QUEUE || 'sensor_data';
const ALERT_QUEUE = 'alert_notifications';
async function initRabbitMQ() {
  connection = await amqplib.connect(RABBITMQ_URL);
  channel = await connection.createChannel();
  await channel.assertQueue(SENSOR_QUEUE, { durable: true });
  await channel.assertQueue(ALERT_QUEUE, { durable: true });
  connection.on('close', () => {
    console.warn('⚠ RabbitMQ connection closed. Reconnecting in 5s...');
    setTimeout(() => {
      initRabbitMQ().catch((err) => {
        console.error('✗ RabbitMQ reconnect failed:', err.message);
      });
    }, 5000);
  });
  return { connection, channel };
}
function getChannel() {
  return channel;
}
function publishToQueue(queue, data) {
  if (!channel) {
    console.warn('⚠ RabbitMQ channel not available, message dropped');
    return false;
  }
  return channel.sendToQueue(queue, Buffer.from(JSON.stringify(data)), {
    persistent: true,
  });
}
async function closeRabbitMQ() {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    channel = null;
    connection = null;
  } catch (err) {
  }
}
module.exports = {
  initRabbitMQ,
  getChannel,
  publishToQueue,
  closeRabbitMQ,
  SENSOR_QUEUE,
  ALERT_QUEUE,
};
