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
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ai_detection_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        device_id INT NOT NULL,
        sensor_data_id BIGINT DEFAULT NULL,
        image_path VARCHAR(255) DEFAULT NULL,
        detection_type VARCHAR(50) DEFAULT 'visual_classification',
        label VARCHAR(20) NOT NULL,
        confidence FLOAT NOT NULL,
        model_version VARCHAR(50) DEFAULT 'XGBoost_v1.0',
        hsv_metadata JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
        FOREIGN KEY (sensor_data_id) REFERENCES sensor_data(id) ON DELETE SET NULL,
        INDEX idx_ai_device_created (device_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
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