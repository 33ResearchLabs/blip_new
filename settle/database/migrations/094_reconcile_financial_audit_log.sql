-- Migration 094: Reconcile financial_audit_log table
--
-- BACKGROUND:
-- Migration 049 creates the `financial_audit_log` table, its immutability
-- triggers, and three indexes. On Railway production, the migration tracker
-- reports 049 as "already applied" yet the table is missing — the CREATE
-- TABLE statement was either skipped or silently rolled back on that
-- environment (possibly due to an early pre-flight abort on an earlier
-- deploy). The result: every auditLog.ts DB write fails at runtime with
-- `relation "financial_audit_log" does not exist` (non-fatal, swallowed,
-- but the audit trail is empty on production).
--
-- This migration re-creates the same objects as 049 using IF NOT EXISTS /
-- CREATE OR REPLACE / DROP IF EXISTS + CREATE. On environments where 049
-- did run correctly (local, staging), every statement is a no-op. On
-- production where the table is missing, this fills in the gap.
--
-- Also adds the two indexes originally intended by migration 092 (skipped
-- there when the table wasn't present). Idempotent and additive — safe to
-- re-run any number of times.

-- ── 1. Immutable financial audit log (copied verbatim from 049) ───────

CREATE TABLE IF NOT EXISTS financial_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL,
  actor_type      TEXT,
  actor_id        TEXT,
  action          TEXT NOT NULL,
  previous_status TEXT,
  new_status      TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutability trigger function (defense-in-depth)
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

-- Original 049 indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_order
  ON financial_audit_log (order_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON financial_audit_log (actor_id, created_at)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON financial_audit_log (action, created_at);

-- ── 2. Migration 092 indexes (originally skipped when table was missing) ─

CREATE INDEX IF NOT EXISTS idx_financial_audit_log_order
  ON financial_audit_log (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_audit_log_actor
  ON financial_audit_log (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;
