-- Remove legacy/vestigial fields: recovery flow is replaced by CLI re-seeding,
-- subscribe code and TOTP replay counter are no longer used.
ALTER TABLE owner DROP COLUMN recovery_codes;
ALTER TABLE owner DROP COLUMN subscribe_code_hash;
ALTER TABLE owner DROP COLUMN last_totp_counter;
