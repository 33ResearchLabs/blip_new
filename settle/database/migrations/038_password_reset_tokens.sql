-- Password reset tokens for merchant forgot-password flow
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL,  -- SHA-256 hash of the token (never store plaintext)
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,                 -- NULL until token is consumed
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast token lookup
CREATE INDEX idx_reset_tokens_hash ON password_reset_tokens(token_hash) WHERE used_at IS NULL;

-- Index for cleanup of expired tokens
CREATE INDEX idx_reset_tokens_expires ON password_reset_tokens(expires_at);

-- Auto-cleanup: delete tokens older than 24 hours
-- (Run via cron or app-level cleanup)
