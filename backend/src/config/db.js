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
    connectionLimit: Number(process.env.MYSQL_POOL_SIZE) > 0 ? Number(process.env.MYSQL_POOL_SIZE) : 10,
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
    await conn.query(`
      CREATE TABLE IF NOT EXISTS sensor_hourly (
        device_id INT NOT NULL,
        hour_start DATETIME NOT NULL,
        n INT NOT NULL,
        suhu_avg FLOAT, suhu_min FLOAT, suhu_max FLOAT,
        salinitas_avg FLOAT, salinitas_min FLOAT, salinitas_max FLOAT,
        turbidity_avg FLOAT, turbidity_min FLOAT, turbidity_max FLOAT,
        jarak_avg FLOAT,
        PRIMARY KEY (device_id, hour_start),
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        user_id INT PRIMARY KEY,
        code_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        attempts TINYINT NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        token_hash CHAR(64) PRIMARY KEY,
        expires_at DATETIME NOT NULL,
        INDEX idx_revoked_exp (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS telegram_queue (
        id VARCHAR(40) PRIMARY KEY,
        priority TINYINT NOT NULL,
        device_id INT NULL,
        alert_data JSON NOT NULL,
        retry_count INT NOT NULL DEFAULT 0,
        next_attempt_at BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        status ENUM('pending','dead') NOT NULL DEFAULT 'pending',
        last_error VARCHAR(255) NULL,
        INDEX idx_tq_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Gateway LoRa: kolom tambahan telemetri siklus ukur (idempotent)
    const cols = { seq: 'INT NULL', adc: 'INT NULL', jarak_cm: 'FLOAT NULL', siklus_status: 'VARCHAR(10) NULL' };
    const [have] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sensor_data'");
    const names = new Set(have.map((r) => r.COLUMN_NAME));
    for (const [c, def] of Object.entries(cols)) {
      if (!names.has(c)) await conn.query(`ALTER TABLE sensor_data ADD COLUMN ${c} ${def}`);
    }
    // Sensor pH dihapus (diganti sensor jarak). Idempotent; enum diubah hanya jika tak ada baris 'ph'.
    if (names.has('ph_level')) await conn.query('ALTER TABLE sensor_data DROP COLUMN ph_level');
    await conn.query("DELETE FROM threshold_config WHERE parameter = 'ph'");
    await conn.query("ALTER TABLE threshold_config MODIFY parameter ENUM('suhu','salinitas','turbidity') NOT NULL COMMENT 'Sensor parameter name'");
    await conn.query(
      "INSERT IGNORE INTO devices (node_id, name, type, lokasi, status) VALUES ('N1', 'Gateway Node N1', 'sensor_node', 'Expo', 'offline')");
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