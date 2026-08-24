-- Replace public subscriptions with admin-managed recipients.
-- Each recipient controls independently whether they receive the last warning
-- and/or the triggered broadcast.

-- deliveries referenced subscribers(id); rebuild without FK against the new table.
DROP TABLE IF EXISTS deliveries;
CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_attempt_at INTEGER
);
CREATE INDEX idx_deliveries_status ON deliveries(status);

DROP TABLE IF EXISTS subscribers;
DROP TABLE IF EXISTS owner_channels;

CREATE TABLE recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL DEFAULT '',
  channel_type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  on_warning INTEGER NOT NULL DEFAULT 0,
  on_trigger INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
