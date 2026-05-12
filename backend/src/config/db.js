const mysql = require('mysql2/promise');
const { InfluxDB } = require('@influxdata/influxdb-client');
let pool = null;
async function initMySQL() {
  pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
    database: process.env.MYSQL_DATABASE || 'bmonitor',
    user: process.env.MYSQL_USER || 'bmonitor_user',
    password: process.env.MYSQL_PASSWORD || 'bmonitor_pass',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  const conn = await pool.getConnection();
  conn.release();
  return pool;
}
function getPool() {
  if (!pool) {
    throw new Error('MySQL pool not initialized. Call initMySQL() first.');
  }
  return pool;
}
async function closeMySQL() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
const influxURL = process.env.INFLUXDB_URL || 'http://localhost:8086';
const influxToken = process.env.INFLUXDB_TOKEN || '';
const influxOrg = process.env.INFLUXDB_ORG || 'bmonitor';
const influxBucket = process.env.INFLUXDB_BUCKET || 'sensor_data';
const influxClient = new InfluxDB({ url: influxURL, token: influxToken });
function getInfluxQueryApi() {
  return influxClient.getQueryApi(influxOrg);
}
function getInfluxWriteApi() {
  return influxClient.getWriteApi(influxOrg, influxBucket, 's');
}
module.exports = {
  initMySQL,
  getPool,
  closeMySQL,
  influxClient,
  influxOrg,
  influxBucket,
  getInfluxQueryApi,
  getInfluxWriteApi,
};