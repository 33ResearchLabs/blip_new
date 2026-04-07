-- Session management: DB-backed refresh tokens with rotation + revocation
-- Enables: logout everywhere, token reuse detection, active device tracking

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL,
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('user', 'merchant', 'compliance')),
  refresh_token_hash TEXT NOT NULL,
  device_info TEXT,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_revoked BOOLEAN NOT NULL DEFAULT false,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID REFERENCES sessions(id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_sessions_entity ON sessions(entity_id, entity_type) WHERE is_revoked = false;
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(refresh_token_hash) WHERE is_revoked = false;
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at) WHERE is_revoked = false;

-- Auto-cleanup: delete expired sessions older than 30 days
-- (run via worker or cron, not automatic)
