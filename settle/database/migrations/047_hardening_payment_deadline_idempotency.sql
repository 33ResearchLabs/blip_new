-- Migration 047: Production Hardening - Payment Deadline + Idempotency
--
-- Adds:
-- 1. payment_deadline / requires_payment_proof on orders (Task 3)
-- 2. idempotency_log table (Task 4)
-- 3. Index for payment deadline expiry worker (Task 3)
--
-- All changes are ADDITIVE — no existing columns/tables modified.

-- ============================================================
-- 1. Payment deadline fields on orders
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_deadline TIMESTAMPTZ NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS requires_payment_proof BOOLEAN NOT NULL DEFAULT false;

-- Index for the payment-deadline expiry worker:
-- SELECT … WHERE status = 'payment_sent' AND payment_deadline < NOW()
CREATE INDEX IF NOT EXISTS idx_orders_payment_deadline_expiry
  ON orders (payment_deadline)
  WHERE status = 'payment_sent'
    AND payment_deadline IS NOT NULL;

-- ============================================================
-- 2. Idempotency log table
-- ============================================================
CREATE TABLE IF NOT EXISTS idempotency_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  action      TEXT NOT NULL,            -- e.g. 'create_order', 'payment_sent', 'release_escrow', 'cancel_order'
  order_id    UUID REFERENCES orders(id),
  status_code INT NOT NULL DEFAULT 200, -- HTTP status returned
  response    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

-- Fast lookup by key
CREATE INDEX IF NOT EXISTS idx_idempotency_log_key ON idempotency_log (idempotency_key);

-- TTL cleanup index (for periodic purge of expired entries)
CREATE INDEX IF NOT EXISTS idx_idempotency_log_expires ON idempotency_log (expires_at);

-- ============================================================
-- 3. Add idempotency_key column on orders (optional, for create-order dedup)
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
