-- Idempotency guard for triggered broadcasts: at most one queued row per
-- recipient per trigger cycle. Concurrent cron invocations (scheduled trigger
-- racing a manual POST /__cron) could otherwise queue the same message twice.
ALTER TABLE deliveries ADD COLUMN cycle INTEGER NOT NULL DEFAULT 0;

-- Backfill so rows queued before this column existed stay unique under the
-- new index (id is unique, so reusing it cannot collide).
UPDATE deliveries SET cycle = id WHERE cycle = 0;

CREATE UNIQUE INDEX idx_deliveries_cycle ON deliveries(recipient_id, cycle);
