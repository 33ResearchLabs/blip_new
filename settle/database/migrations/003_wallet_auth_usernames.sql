-- Migration: Wallet-based Authentication with Usernames
-- This migration updates the authentication system to use wallet signatures
-- and adds unique usernames across all user types

-- =====================
-- 1. Update Users Table
-- =====================

-- Make password optional (for wallet-only auth)
ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

-- Make wallet_address required and add constraint
ALTER TABLE users
  ALTER COLUMN wallet_address SET NOT NULL;

-- Add unique constraint on username (already exists but ensure it's there)
-- Username is already UNIQUE in schema, this is for safety
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_username_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
  END IF;
END $$;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- =====================
-- 2. Update Merchants Table
-- =====================

-- Add username field for merchants
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;

-- Make email optional for wallet-only merchants
ALTER TABLE merchants
  ALTER COLUMN email DROP NOT NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_merchants_wallet_address ON merchants(wallet_address);
CREATE INDEX IF NOT EXISTS idx_merchants_username ON merchants(username);

-- =====================
-- 3. Create Global Username Constraint
-- =====================

-- Create a function to check username uniqueness across all tables
CREATE OR REPLACE FUNCTION check_username_unique()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if username exists in users table
  IF EXISTS (
    SELECT 1 FROM users
    WHERE username = NEW.username
    AND (TG_TABLE_NAME != 'users' OR id != NEW.id)
  ) THEN
    RAISE EXCEPTION 'Username already exists';
  END IF;

  -- Check if username exists in merchants table
  IF EXISTS (
    SELECT 1 FROM merchants
    WHERE username = NEW.username
    AND (TG_TABLE_NAME != 'merchants' OR id != NEW.id)
  ) THEN
    RAISE EXCEPTION 'Username already exists';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for both tables
DROP TRIGGER IF EXISTS check_username_unique_users ON users;
CREATE TRIGGER check_username_unique_users
  BEFORE INSERT OR UPDATE OF username ON users
  FOR EACH ROW
  EXECUTE FUNCTION check_username_unique();

DROP TRIGGER IF EXISTS check_username_unique_merchants ON merchants;
CREATE TRIGGER check_username_unique_merchants
  BEFORE INSERT OR UPDATE OF username ON merchants
  FOR EACH ROW
  EXECUTE FUNCTION check_username_unique();

-- =====================
-- 4. Clear Demo/Test Data
-- =====================

-- Remove all test users
DELETE FROM users WHERE username IN ('alice', 'bob', 'charlie');
DELETE FROM users WHERE wallet_address LIKE '%test%';

-- Remove all test merchants
DELETE FROM merchants WHERE email LIKE '%@merchant.com';
DELETE FROM merchants WHERE email LIKE '%@test.com';

-- Clear compliance test accounts
DELETE FROM compliance_team WHERE email LIKE '%@blip.money';

-- =====================
-- 5. Add Comments
-- =====================

COMMENT ON COLUMN users.password_hash IS 'Optional - only used for legacy accounts. New users authenticate via wallet signature';
COMMENT ON COLUMN users.wallet_address IS 'Solana wallet address - primary authentication method';
COMMENT ON COLUMN users.username IS 'Unique username across all users and merchants. Cannot be changed after creation';

COMMENT ON COLUMN merchants.username IS 'Unique username across all users and merchants. Cannot be changed after creation';
COMMENT ON COLUMN merchants.wallet_address IS 'Solana wallet address - primary authentication method';
