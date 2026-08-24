-- Owner's own notification channels (for last-warning delivery + test sends)
CREATE TABLE owner_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Fixed-window rate limiting (login / recover / subscribe)
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

-- Retry spacing for deliveries
ALTER TABLE deliveries ADD COLUMN last_attempt_at INTEGER;

-- TOTP replay prevention: highest consumed timeslice
ALTER TABLE owner ADD COLUMN last_totp_counter INTEGER NOT NULL DEFAULT 0;
