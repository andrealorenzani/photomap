CREATE TABLE nominatim_rate_limit (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  -- Stored as a raw Unix timestamp with microsecond precision (PHP microtime(true)),
  -- not a MySQL DATETIME, because DATETIME's second-level resolution is too coarse to
  -- correctly enforce sub-second spacing (used by tests, production uses whole seconds).
  last_request_at DOUBLE NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO nominatim_rate_limit (id, last_request_at) VALUES (1, NULL);
