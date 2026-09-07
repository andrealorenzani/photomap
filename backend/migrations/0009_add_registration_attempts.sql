-- Dedicated table for registration anti-spam rate limiting, separate from `login_attempts`:
-- every POST /api/register counts against this window, not just failures against an existing
-- account (login_attempts' semantics don't fit -- there's no "succeeded" concept here).
CREATE TABLE registration_attempts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_registration_attempts_ip_created (ip_address, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
