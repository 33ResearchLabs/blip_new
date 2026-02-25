-- Migration 034: Event architecture enhancements
-- Adds idempotency, dead letter queue, audit log, and auth tables

-- 1. Add idempotency key to notification_outbox
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_idempotency
  ON notification_outbox(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 2. Add actor columns to order_events (if missing)
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20);
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS actor_id UUID;
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS old_status VARCHAR(30);
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS new_status VARCHAR(30);
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 3. Dead Letter Queue for permanently failed notifications
CREATE TABLE IF NOT EXISTS notification_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_outbox_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  attempts INT NOT NULL,
  last_error TEXT,
  first_attempt_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolution_status VARCHAR(20) DEFAULT 'unresolved'
    CHECK (resolution_status IN ('unresolved', 'retried', 'resolved_manually', 'discarded')),
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(100),
  resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_dlq_unresolved
  ON notification_dead_letters(resolution_status, dead_lettered_at)
  WHERE resolution_status = 'unresolved';

CREATE INDEX IF NOT EXISTS idx_dlq_order
  ON notification_dead_letters(order_id);

-- 4. Audit log for sensitive operations
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_type VARCHAR(20) NOT NULL,
  actor_id UUID,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON audit_log(actor_type, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON audit_log(resource_type, resource_id, created_at DESC);

-- 5. Auth nonces for wallet challenge-response
CREATE TABLE IF NOT EXISTS auth_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(64) NOT NULL,
  nonce VARCHAR(64) NOT NULL UNIQUE,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nonces_wallet
  ON auth_nonces(wallet_address, expires_at);

-- 6. Refresh tokens for JWT auth
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  actor_type VARCHAR(20) NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_actor
  ON refresh_tokens(actor_id, revoked);

-- 7. Feature flags
CREATE TABLE IF NOT EXISTS feature_flags (
  name VARCHAR(100) PRIMARY KEY,
  enabled BOOLEAN DEFAULT false,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial feature flags (all disabled)
INSERT INTO feature_flags (name, description) VALUES
  ('jwt_auth', 'JWT-based authentication replacing body-param trust'),
  ('redis_rate_limit', 'Redis-backed rate limiting for multi-instance'),
  ('system_chat_messages', 'Auto-generate system chat messages on status change'),
  ('read_replica', 'Route read queries to PG read replica'),
  ('c2c_trading', 'Crypto-to-crypto trading support')
ON CONFLICT (name) DO NOTHING;

-- 8. Cleanup function for expired auth data
CREATE OR REPLACE FUNCTION cleanup_expired_auth() RETURNS void AS $$
BEGIN
  DELETE FROM auth_nonces WHERE expires_at < NOW();
  DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = true;
END;
$$ LANGUAGE plpgsql;
