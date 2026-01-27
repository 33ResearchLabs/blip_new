-- Migration: Email/Password Authentication for Merchants
-- This migration adds support for email/password login alongside wallet auth

-- =====================
-- 1. Make wallet_address optional for email-only merchants
-- =====================
ALTER TABLE merchants
  ALTER COLUMN wallet_address DROP NOT NULL;

-- =====================
-- 2. Add password_hash for email/password auth
-- =====================
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- =====================
-- 3. Add index on email for faster lookups
-- =====================
CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);

-- =====================
-- 4. Add comments
-- =====================
COMMENT ON COLUMN merchants.password_hash IS 'Hashed password for email/password authentication. NULL for wallet-only merchants';
