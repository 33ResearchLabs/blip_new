-- Migration 049: Fintech-Grade Hardening
--
-- Adds:
-- 1. Scoped idempotency: actor_id + original_key columns on idempotency_log
-- 2. Immutable financial audit log table (INSERT only)
-- 3. Final-state protection index (defense-in-depth — app + trigger already guard this)
--
-- All changes are ADDITIVE — no existing columns/tables modified or removed.

-- ============================================================
-- 1. Scoped idempotency columns
--    The idempotency_key column now stores a SHA-256 hash of
--    (actor_id + action + original_key). These new columns store
--    the raw components for debugging and auditing.
-- ============================================================

ALTER TABLE idempotency_log ADD COLUMN IF NOT EXISTS actor_id TEXT;
ALTER TABLE idempotency_log ADD COLUMN IF NOT EXISTS original_key TEXT;

-- Index for debugging: find all idempotency entries for a specific actor
CREATE INDEX IF NOT EXISTS idx_idempotency_log_actor
  ON idempotency_log (actor_id)
  WHERE actor_id IS NOT NULL;

-- ============================================================
-- 2. Immutable financial audit log
--    INSERT-only table. Application code MUST NOT issue UPDATE or DELETE.
--    Every financial action (create, pay, release, cancel, dispute)
--    is logged with full context for compliance and forensics.
-- ============================================================

CREATE TABLE IF NOT EXISTS financial_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL,
  actor_type      TEXT,                  -- 'user', 'merchant', 'system'
  actor_id        TEXT,                  -- UUID of the acting entity
  action          TEXT NOT NULL,         -- e.g. 'order_created', 'escrow_locked', 'payment_sent',
                                         --      'escrow_released', 'order_cancelled', 'dispute_opened',
                                         --      'dispute_resolved_merchant', 'dispute_resolved_user',
                                         --      'order_expired'
  previous_status TEXT,                  -- order status before the action
  new_status      TEXT NOT NULL,         -- order status after the action
  metadata        JSONB NOT NULL DEFAULT '{}',  -- tx_hash, amounts, resolution details, etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent accidental deletes/updates via a trigger (defense-in-depth)
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'financial_audit_log is immutable: UPDATE and DELETE are prohibited'
    USING ERRCODE = 'restrict_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_audit_log_immutable_update ON financial_audit_log;
CREATE TRIGGER trigger_audit_log_immutable_update
  BEFORE UPDATE ON financial_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS trigger_audit_log_immutable_delete ON financial_audit_log;
CREATE TRIGGER trigger_audit_log_immutable_delete
  BEFORE DELETE ON financial_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();

-- Indexes for common audit queries
CREATE INDEX IF NOT EXISTS idx_audit_log_order
  ON financial_audit_log (order_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON financial_audit_log (actor_id, created_at)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON financial_audit_log (action, created_at);

-- ============================================================
-- 3. Final-state protection
--    The DB trigger in migration 048 already blocks transitions
--    FROM completed/cancelled/expired. This adds a partial index
--    that helps the app quickly skip terminal-state orders in
--    bulk-update queries (workers, cleanup jobs).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_orders_non_terminal
  ON orders (status, expires_at)
  WHERE status NOT IN ('completed', 'cancelled', 'expired');
