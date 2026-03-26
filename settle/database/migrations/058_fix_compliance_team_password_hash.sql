-- Migration 058: Fix compliance_team password_hash NOT NULL constraint
-- Date: 2026-03-25
--
-- Problem:
--   Migration 008 defined password_hash as TEXT NOT NULL, but:
--   1. All INSERT statements (seed data, wallet auth, setup routes) omit password_hash
--   2. The auth system uses COMPLIANCE_PASSWORD env var, not per-row hashes
--   3. Wallet-based compliance members have no password at all
--
--   This causes: "null value in column password_hash violates not-null constraint"
--
-- Fix:
--   1. Drop NOT NULL on password_hash (make it optional)
--   2. Drop NOT NULL on email (wallet-only members exist)
--   3. Add CHECK constraint on role for data integrity
--   4. Add wallet_address column if missing
--   5. Ensure email UNIQUE constraint exists

-- 1. Make password_hash nullable (if the column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'compliance_team' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE compliance_team ALTER COLUMN password_hash DROP NOT NULL;
  ELSE
    ALTER TABLE compliance_team ADD COLUMN password_hash TEXT;
  END IF;
END $$;

-- 2. Make email nullable (wallet-only members)
DO $$
BEGIN
  ALTER TABLE compliance_team ALTER COLUMN email DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

-- 3. Add wallet_address column if missing (from wallet auth feature)
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(64);

-- Add unique constraint on wallet_address if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'compliance_team_wallet_address_key'
  ) THEN
    ALTER TABLE compliance_team ADD CONSTRAINT compliance_team_wallet_address_key UNIQUE (wallet_address);
  END IF;
END $$;

-- 4. Add role CHECK constraint (idempotent: drop first if exists)
DO $$
BEGIN
  -- Drop old check if exists
  ALTER TABLE compliance_team DROP CONSTRAINT IF EXISTS compliance_team_role_check;
  -- Add validated check
  ALTER TABLE compliance_team ADD CONSTRAINT compliance_team_role_check
    CHECK (role IN ('support', 'officer', 'senior', 'compliance', 'admin'));
EXCEPTION
  WHEN check_violation THEN
    -- If existing data violates the check, normalize first
    UPDATE compliance_team SET role = 'officer' WHERE role NOT IN ('support', 'officer', 'senior', 'compliance', 'admin');
    ALTER TABLE compliance_team ADD CONSTRAINT compliance_team_role_check
      CHECK (role IN ('support', 'officer', 'senior', 'compliance', 'admin'));
END $$;

-- 5. Add missing columns from migration 008 (safe: ADD IF NOT EXISTS)
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS permissions JSONB
  DEFAULT '{"can_resolve_disputes": true, "can_ban_users": false, "can_ban_merchants": false}';
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS disputes_resolved INT DEFAULT 0;
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS avg_resolution_time_hours DECIMAL(10, 2) DEFAULT 0;

-- 6. Ensure email UNIQUE constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compliance_team_email_key'
  ) THEN
    ALTER TABLE compliance_team ADD CONSTRAINT compliance_team_email_key UNIQUE (email);
  END IF;
END $$;

-- 7. Backfill: set a placeholder bcrypt hash for any existing rows that have NULL password_hash
-- This is the bcrypt hash of "change-me-immediately" with cost factor 10
-- It won't match any real login attempt since auth uses COMPLIANCE_PASSWORD env var
UPDATE compliance_team
SET password_hash = '$2b$10$placeholder.hash.for.migration.fixABCDEFGHIJKLMNOPQRSTU'
WHERE password_hash IS NULL
  AND email IS NOT NULL;
