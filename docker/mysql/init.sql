USE bmonitor;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
    kontak_telegram VARCHAR(50) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    node_id VARCHAR(50) NOT NULL UNIQUE COMMENT 'Hardware identifier (e.g. ESP32-NODE-01)',
    name VARCHAR(100) NOT NULL,
    type ENUM('sensor_node', 'gateway') NOT NULL DEFAULT 'sensor_node',
    mac_address VARCHAR(17) DEFAULT NULL,
    lokasi VARCHAR(255) DEFAULT NULL COMMENT 'Physical location description',
    user_id INT DEFAULT NULL,
    status ENUM('online', 'offline', 'maintenance') NOT NULL DEFAULT 'offline',
    last_seen TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sensor_data (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    suhu FLOAT,
    salinitas FLOAT,
    baterai FLOAT,
    rssi INT,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    INDEX idx_device_recorded (device_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS fuzzy_decisions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    sensor_data_id BIGINT DEFAULT NULL,
    suhu_membership VARCHAR(50),
    salinitas_membership VARCHAR(50),
    visual_label VARCHAR(20),
    dss_score FLOAT,
    dss_recommendation VARCHAR(50),
    fired_rules JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (sensor_data_id) REFERENCES sensor_data(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS actuator_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    aksi VARCHAR(50),
    trigger_source VARCHAR(50),
    trigger_detail TEXT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS threshold_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    user_id INT NOT NULL COMMENT 'User who last modified this threshold',
    parameter ENUM('suhu', 'salinitas') NOT NULL COMMENT 'Sensor parameter name',
    batas_bawah DECIMAL(10, 2) NOT NULL COMMENT 'Minimum threshold',
    batas_atas DECIMAL(10, 2) NOT NULL COMMENT 'Maximum threshold',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_device_param (device_id, parameter),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alert_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    sensor_data_id BIGINT DEFAULT NULL,
    parameter VARCHAR(50) NOT NULL,
    measured_value DECIMAL(10, 2) NOT NULL COMMENT 'Actual sensor reading that triggered alert',
    threshold_min DECIMAL(10, 2) NOT NULL,
    threshold_max DECIMAL(10, 2) NOT NULL,
    level_peringatan VARCHAR(50) NOT NULL DEFAULT 'warning',
    pesan_notifikasi TEXT NOT NULL COMMENT 'Human-readable alert message',
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (sensor_data_id) REFERENCES sensor_data(id) ON DELETE CASCADE,
    FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_device_created (device_id, created_at),
    INDEX idx_level_created (level_peringatan, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO users (name, username, email, password_hash, role) VALUES
    ('Administrator', 'admin', 'admin@bmonitor.local', '$2a$10$GIlavMyST/GCudOOEkKvcuuU0Xo.vLiafBlNjdsjd4FdHH6YGYwqC', 'admin')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO devices (node_id, name, type, mac_address, lokasi, status) VALUES
    ('ESP32-NODE-01', 'Sensor Node 01', 'sensor_node', 'AA:BB:CC:DD:EE:01', 'Pond Unit 04 - North', 'online'),
    ('ESP32-NODE-02', 'Sensor Node 02', 'sensor_node', 'AA:BB:CC:DD:EE:02', 'Pond Unit 04 - South', 'offline'),
    ('ESP32-NODE-03', 'Sensor Node 03', 'sensor_node', 'AA:BB:CC:DD:EE:03', 'Pond Unit 04 - East', 'online'),
    ('LORA-GW-01', 'LoRa Gateway 01', 'gateway', 'AA:BB:CC:DD:FF:01', 'Pond Unit 04 - Central', 'online')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO threshold_config (device_id, user_id, parameter, batas_bawah, batas_atas) VALUES
    (1, 1, 'suhu', 18.50, 28.00),
    (1, 1, 'salinitas', 10.00, 35.00)
ON DUPLICATE KEY UPDATE batas_bawah = VALUES(batas_bawah), batas_atas = VALUES(batas_atas);
