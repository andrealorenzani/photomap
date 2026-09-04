CREATE TABLE geocode_cache (
  lat_rounded DECIMAL(6,4) NOT NULL,
  lon_rounded DECIMAL(6,4) NOT NULL,
  place_name VARCHAR(500) NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (lat_rounded, lon_rounded)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
