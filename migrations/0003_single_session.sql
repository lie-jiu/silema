-- Single-active-session: incremented on every login/recovery,
-- tokens embed the epoch and are rejected when it no longer matches.
ALTER TABLE owner ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 1;
