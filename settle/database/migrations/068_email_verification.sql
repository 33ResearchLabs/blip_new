-- Email verification for merchants
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;

-- Verification tokens
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verify_token ON email_verification_tokens(token_hash) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_verify_merchant ON email_verification_tokens(merchant_id);

-- Mark existing merchants as verified (backward compat)
UPDATE merchants SET email_verified = true WHERE email IS NOT NULL AND email_verified IS NULL;
UPDATE merchants SET email_verified = true WHERE email_verified IS NULL;
