const mysql = require('mysql2/promise');
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

module.exports = {
  initMySQL,
  getPool,
  closeMySQL,
};