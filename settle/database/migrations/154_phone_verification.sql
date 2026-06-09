-- Migration 154: Phone verification columns on users
-- Adds phone number + verified flag used as a buy-order gate.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
  ON users (phone)
  WHERE phone IS NOT NULL;
