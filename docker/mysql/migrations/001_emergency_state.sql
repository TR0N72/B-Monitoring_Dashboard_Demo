CREATE TABLE IF NOT EXISTS emergency_state (
  device_id INT NOT NULL PRIMARY KEY,
  emergency_active TINYINT(1) NOT NULL DEFAULT 0,
  emergency_activated_at BIGINT NULL COMMENT 'epoch ms',
  engine_stop_pending TINYINT(1) NOT NULL DEFAULT 0,
  engine_stop_sent_at BIGINT NULL COMMENT 'epoch ms',
  engine_stop_command_id BIGINT NULL,
  last_notified_at BIGINT NULL COMMENT 'epoch ms',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
