-- Migration 151: API keys for agentic / programmatic merchant access
--
-- Enables machine-to-machine auth for merchants: create a key via
-- POST /api/auth/api-keys, then send it as Bearer sk_live_<token> on any
-- merchant-authenticated endpoint instead of a session token.
--
-- Key lifecycle:
--   1. POST /api/auth/api-keys  → returns full key ONCE (sk_live_<32hex>)
--   2. Only key_hash (SHA-256) stored in DB; full key is never stored
--   3. Verify: SHA-256(incoming) = key_hash → merchant_id is the actor
--   4. DELETE /api/auth/api-keys/:id or revoked_at IS NOT NULL → rejected
--
-- Permission scopes (stored as JSONB array of strings):
--   "orders:read"    - GET orders
--   "orders:write"   - create orders, state transitions
--   "wallet:read"    - balance, ledger
--   "notifications"  - Pusher/webhook subscriptions
--   default: all four (full merchant access)

CREATE TABLE IF NOT EXISTS api_keys (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  key_prefix      TEXT        NOT NULL,          -- first 12 chars of the raw key (shown in UI)
  key_hash        TEXT        NOT NULL UNIQUE,   -- SHA-256 hex of the full raw key
  permissions     JSONB       NOT NULL DEFAULT '["orders:read","orders:write","wallet:read","notifications"]'::jsonb,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  revoked_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_merchant_id ON api_keys(merchant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash    ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON api_keys(merchant_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE  api_keys             IS 'Programmatic API keys for merchant machine-to-machine access';
COMMENT ON COLUMN api_keys.key_prefix  IS 'First 12 chars of the raw key — displayed in UI, NOT secret';
COMMENT ON COLUMN api_keys.key_hash    IS 'SHA-256 hex of the full raw key — only thing stored server-side';
COMMENT ON COLUMN api_keys.permissions IS 'JSON array of allowed scopes';
