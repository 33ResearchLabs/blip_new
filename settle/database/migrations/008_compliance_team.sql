-- Migration: Add compliance team table
-- Date: 2026-02-01
-- Required by: websocket-server.js for getSenderName function
--
-- NOTE: password_hash is intentionally NULLABLE.
-- The compliance auth system uses a shared COMPLIANCE_PASSWORD env var,
-- NOT per-row password hashes. The column exists only for future use
-- (e.g., if individual bcrypt-hashed passwords are added later).
-- Making it NOT NULL would break all seed inserts and wallet-based auth.

-- Create compliance team table for dispute resolution officers
CREATE TABLE IF NOT EXISTS compliance_team (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity (at least one of email or wallet_address must be set)
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE,
  wallet_address VARCHAR(64) UNIQUE,
  password_hash TEXT,  -- nullable: auth currently uses env var, not per-row hashes
  phone VARCHAR(20),
  avatar_url TEXT,

  -- Role and permissions
  role VARCHAR(50) DEFAULT 'officer' CHECK (role IN ('support', 'officer', 'senior', 'compliance', 'admin')),
  permissions JSONB DEFAULT '{"can_resolve_disputes": true, "can_ban_users": false, "can_ban_merchants": false}',

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,

  -- Stats
  disputes_resolved INT DEFAULT 0,
  avg_resolution_time_hours DECIMAL(10, 2) DEFAULT 0,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure email uniqueness (if table was created by migration 002 without this)
-- The UNIQUE constraint is part of the CREATE TABLE above, but if the table
-- already exists from migration 002, we need to add it explicitly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compliance_team_email_key'
  ) THEN
    ALTER TABLE compliance_team ADD CONSTRAINT compliance_team_email_key UNIQUE (email);
  END IF;
END $$;

-- Add missing columns if table predates this migration.
-- NOTE: UNIQUE constraints are added separately via DO blocks to avoid
-- duplicate_object errors when the constraint already exists.
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(64);
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS permissions JSONB
  DEFAULT '{"can_resolve_disputes": true, "can_ban_users": false, "can_ban_merchants": false}';
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS disputes_resolved INT DEFAULT 0;
ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS avg_resolution_time_hours DECIMAL(10, 2) DEFAULT 0;

-- Add UNIQUE on wallet_address if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compliance_team_wallet_address_key'
  ) THEN
    ALTER TABLE compliance_team ADD CONSTRAINT compliance_team_wallet_address_key UNIQUE (wallet_address);
  END IF;
END $$;

-- If password_hash was previously NOT NULL, drop the constraint
-- (safe because auth uses env var COMPLIANCE_PASSWORD, not per-row hashes)
DO $$
BEGIN
  ALTER TABLE compliance_team ALTER COLUMN password_hash DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

-- Also make email nullable (wallet-only compliance members exist)
DO $$
BEGIN
  ALTER TABLE compliance_team ALTER COLUMN email DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

-- Create index for active compliance officers
CREATE INDEX IF NOT EXISTS idx_compliance_team_active ON compliance_team(is_active) WHERE is_active = true;

-- Add trigger for updated_at (idempotent: drop first to avoid duplicate trigger error)
DROP TRIGGER IF EXISTS update_compliance_team_updated_at ON compliance_team;
CREATE TRIGGER update_compliance_team_updated_at
  BEFORE UPDATE ON compliance_team
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Add assigned_to column to disputes table for tracking which officer handles the dispute
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES compliance_team(id);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

-- Create index for officer workload queries
CREATE INDEX IF NOT EXISTS idx_disputes_assigned ON disputes(assigned_to, status);

-- Comments
COMMENT ON TABLE compliance_team IS 'Compliance officers who handle disputes and user/merchant issues';
COMMENT ON COLUMN compliance_team.role IS 'Role level: support, officer, senior, compliance, admin';
COMMENT ON COLUMN compliance_team.password_hash IS 'Optional bcrypt hash. Auth currently uses COMPLIANCE_PASSWORD env var instead.';
COMMENT ON COLUMN disputes.assigned_to IS 'Compliance officer assigned to handle this dispute';
