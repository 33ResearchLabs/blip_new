-- Migration 092: Audit & Safety Hardening (zero-regression additive changes)
--
-- Three additive improvements:
--   1. Safety-net trigger: auto-set payment_deadline if status→payment_sent and column is NULL
--      (application code in core-api / settle / claimAndPayOrder remains source of truth;
--       trigger only fires when application forgot to set it)
--   2. Add actor_ip + session_id columns to order_events for forensic audit trail
--      (NULL-default, all existing INSERTs continue to work unchanged)
--   3. Index on financial_audit_log for queryable audit history per order
--
-- All changes are additive. No existing columns, constraints, or triggers are
-- modified or removed. Migration is fully idempotent and re-runnable.

-- ── 1. Safety-net trigger for payment_deadline ─────────────────────────
-- Fires only when:
--   - Status transitions INTO 'payment_sent' (not within or out of)
--   - payment_deadline is NULL (never overwrites application-set values)
--
-- Application paths that already set payment_deadline:
--   - apps/core-api/src/routes/orders.ts (payment-method-aware: 60min/4h/48h)
--   - settle/src/lib/db/repositories/orders.ts (updateOrderStatus switch case)
--   - settle/src/lib/db/repositories/orders.ts (claimAndPayOrder — fixed in this PR)
--
-- This trigger is a defense-in-depth safety net for any future code path
-- that transitions to payment_sent without explicitly setting the deadline.

CREATE OR REPLACE FUNCTION set_payment_deadline_safety_net()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'payment_sent'
     AND OLD.status IS DISTINCT FROM 'payment_sent'
     AND NEW.payment_deadline IS NULL
  THEN
    NEW.payment_deadline := NOW() + INTERVAL '24 hours';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_deadline_safety_net ON orders;
CREATE TRIGGER trg_payment_deadline_safety_net
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION set_payment_deadline_safety_net();

-- ── 2. Forensic audit columns on order_events ──────────────────────────
-- Both columns are NULL-default. Existing INSERTs that don't reference
-- these columns continue to work — Postgres inserts NULL automatically.

ALTER TABLE order_events ADD COLUMN IF NOT EXISTS actor_ip   TEXT NULL;
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS session_id TEXT NULL;

-- ── 3. Indexes for financial_audit_log ──────────────────────────────────
-- The financial_audit_log table (migration 049) is now actively written to
-- by auditLog.ts. These indexes support the most common audit queries:
--   - "show all events for order X"
--   - "show all events by actor Y"
--
-- DEFENSIVE: wrapped in a DO block that checks the table exists first.
-- Some environments skipped migration 049 (e.g. Railway where 049 never
-- ran due to tracking drift), so we must not fail hard here — otherwise
-- core-api startup pre-flight aborts the whole deploy. If the table is
-- missing, auditLog.ts still works (it try/catch-swallows DB write
-- failures), we just can't have the indexes until 049 is reconciled.

DO $$
BEGIN
  IF to_regclass('public.financial_audit_log') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_financial_audit_log_order
             ON financial_audit_log (order_id, created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_financial_audit_log_actor
             ON financial_audit_log (actor_id, created_at DESC)
             WHERE actor_id IS NOT NULL';
  ELSE
    RAISE NOTICE '[092] financial_audit_log table missing — skipping index creation (migration 049 did not run here)';
  END IF;
END
$$;
