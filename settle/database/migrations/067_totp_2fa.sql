-- TOTP-based Two-Factor Authentication
-- Adds 2FA fields to merchants and users tables

-- Merchants
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMPTZ;

-- Users
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMPTZ;

-- Temporary 2FA login tokens (short-lived, used between password check and TOTP verify)
CREATE TABLE IF NOT EXISTS totp_pending_logins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('user', 'merchant')),
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_totp_pending_token ON totp_pending_logins(token_hash) WHERE NOT used;
CREATE INDEX IF NOT EXISTS idx_totp_pending_cleanup ON totp_pending_logins(expires_at) WHERE NOT used;

-- Rate limiting for OTP attempts
CREATE TABLE IF NOT EXISTS totp_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  actor_type VARCHAR(20) NOT NULL,
  success BOOLEAN NOT NULL,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_totp_attempts_actor ON totp_attempts(actor_id, created_at DESC);
