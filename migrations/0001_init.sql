-- Owner configuration (single row)
CREATE TABLE owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret TEXT NOT NULL,
  recovery_codes TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  expiry_hours INTEGER NOT NULL DEFAULT 24,
  warning_hours INTEGER NOT NULL DEFAULT 12,
  subscribe_code_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'normal',
  last_checkin_at INTEGER,
  warning_sent_at INTEGER,
  triggered_at INTEGER
);

-- Daily checkin records
CREATE TABLE checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at INTEGER NOT NULL
);
CREATE INDEX idx_checkins_time ON checkins(checked_at);

-- Subscribers
CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT,
  verify_expires_at INTEGER,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- Message templates (one per channel)
CREATE TABLE messages (
  channel_type TEXT PRIMARY KEY,
  subject TEXT,
  body TEXT NOT NULL,
  image_keys TEXT
);

-- Delivery logs (for triggered broadcast + retries)
CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_id INTEGER NOT NULL REFERENCES subscribers(id),
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX idx_deliveries_status ON deliveries(status);