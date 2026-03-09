-- Migration 036: Server-side idempotency keys
-- Prevents duplicate state transitions, ledger entries, and events from retries/double-submits

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key           TEXT PRIMARY KEY,
  route         TEXT NOT NULL,
  order_id      UUID,
  request_hash  TEXT,
  status        TEXT NOT NULL DEFAULT 'in_progress',   -- 'in_progress' | 'completed' | 'failed'
  response_code INT,
  response_json JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);

-- Fast lookup by order_id (debug / ops queries)
CREATE INDEX IF NOT EXISTS idx_idempotency_order
  ON idempotency_keys(order_id)
  WHERE order_id IS NOT NULL;

-- Cleanup job target: DELETE FROM idempotency_keys WHERE expires_at < NOW()
CREATE INDEX IF NOT EXISTS idx_idempotency_expires
  ON idempotency_keys(expires_at);
