-- Message content now lives on each RECIPIENT, not per channel:
--   warning_content = text sent to this recipient when the warning STARTS
--   trigger_content = text sent when the warning ends unconfirmed (broadcast)
-- The first line of each content acts as the title. Legacy rows have empty
-- content and fall back to built-in defaults until the owner edits them.
-- (messages table is intentionally kept — it may hold old templates the
--  owner still wants to copy from; the app simply no longer reads it.)
ALTER TABLE recipients ADD COLUMN warning_content TEXT NOT NULL DEFAULT '';
ALTER TABLE recipients ADD COLUMN trigger_content TEXT NOT NULL DEFAULT '';
