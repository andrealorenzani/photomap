ALTER TABLE users
  ADD COLUMN status ENUM('pending','active','disabled') NOT NULL DEFAULT 'pending' AFTER password_hash,
  ADD COLUMN storage_quota_bytes BIGINT UNSIGNED NULL AFTER status,
  ADD COLUMN approved_at DATETIME NULL AFTER storage_quota_bytes,
  ADD INDEX idx_users_status (status),
  ADD INDEX idx_users_created_at (created_at);

-- Grandfather in every account that existed before this policy: without this, every current
-- production user would silently lose upload access the moment this migration runs. Only rows
-- that pre-date this migration are still 'pending' at this point (new registrations from this
-- point forward insert 'pending' explicitly via AuthController::register(), so this UPDATE is a
-- one-time correction, not an ongoing behavior).
UPDATE users SET status = 'active' WHERE status = 'pending';
