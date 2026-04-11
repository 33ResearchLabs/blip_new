-- 2FA backup codes (single-use recovery codes)
-- Stored as SHA-256 hashes — never as plaintext.
-- Generated when the user enables TOTP, can be regenerated later.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[] NOT NULL DEFAULT '{}';
