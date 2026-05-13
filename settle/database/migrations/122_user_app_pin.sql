-- Migration 122: App PIN for users
--
-- 4-6 digit numeric PIN that gates money-moving actions (UPI scan-to-pay, and
-- in future: any send/withdraw/escrow-lock). Stored as a bcrypt hash, never
-- in plaintext. Separate from the account password — losing one doesn't
-- compromise the other.
--
-- Verification is rate-limited at the API layer (5 attempts / 15 min).
-- `pin_locked_until` lets us short-circuit verification without hitting bcrypt
-- when an attacker has burned through the rate limit budget.

ALTER TABLE users ADD COLUMN IF NOT EXISTS user_pin_hash       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_pin_set_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_pin_failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_pin_locked_until    TIMESTAMPTZ;

COMMENT ON COLUMN users.user_pin_hash IS
  'bcrypt-hashed 4-6 digit numeric PIN. NULL = user has not set a PIN yet.';
COMMENT ON COLUMN users.user_pin_locked_until IS
  'Set when failed_attempts exceeds threshold; verification fast-fails until this passes.';
