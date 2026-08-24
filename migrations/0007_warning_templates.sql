-- Per-channel templates now cover BOTH outbound messages:
--   subject / body                    = triggered broadcast (final words)
--   warning_subject / warning_body    = last-warning notice to the owner
-- Empty warning_* fields fall back to built-in defaults at send time.
ALTER TABLE messages ADD COLUMN warning_subject TEXT;
ALTER TABLE messages ADD COLUMN warning_body TEXT;
