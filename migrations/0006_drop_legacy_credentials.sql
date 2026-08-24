-- Credentials live exclusively in Worker secrets (ADMIN_USERNAME /
-- ADMIN_PASSWORD); these columns have been vestigial since that move.
ALTER TABLE owner DROP COLUMN username;
ALTER TABLE owner DROP COLUMN password_hash;
