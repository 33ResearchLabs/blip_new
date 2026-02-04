-- Migration: Add compliance team table
-- Date: 2026-02-01
-- Required by: websocket-server.js for getSenderName function

-- Create compliance team table for dispute resolution officers
CREATE TABLE IF NOT EXISTS compliance_team (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Basic info
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone VARCHAR(20),
  avatar_url TEXT,

  -- Role and permissions
  role VARCHAR(50) DEFAULT 'officer', -- officer, senior, admin
  permissions JSONB DEFAULT '{"can_resolve_disputes": true, "can_ban_users": false, "can_ban_merchants": false}',

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMP,

  -- Stats
  disputes_resolved INT DEFAULT 0,
  avg_resolution_time_hours DECIMAL(10, 2) DEFAULT 0,

  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for active compliance officers
CREATE INDEX IF NOT EXISTS idx_compliance_team_active ON compliance_team(is_active) WHERE is_active = true;

-- Add trigger for updated_at
CREATE TRIGGER update_compliance_team_updated_at
  BEFORE UPDATE ON compliance_team
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Add assigned_to column to disputes table for tracking which officer handles the dispute
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES compliance_team(id);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;

-- Create index for officer workload queries
CREATE INDEX IF NOT EXISTS idx_disputes_assigned ON disputes(assigned_to, status);

-- Comments
COMMENT ON TABLE compliance_team IS 'Compliance officers who handle disputes and user/merchant issues';
COMMENT ON COLUMN compliance_team.role IS 'Role level: officer, senior, admin';
COMMENT ON COLUMN disputes.assigned_to IS 'Compliance officer assigned to handle this dispute';
