-- Migration 128: Permission audit log
--
-- Purpose
--   Records every change to merchant role-permission flags
--   (has_compliance_access, has_ops_access). Without this log, an admin
--   (or a compromised admin account, or a SQL-injection elsewhere) could
--   silently grant compliance privileges and no forensic trail would
--   exist. This is the audit gap called out in the security review.
--
-- Scope
--   Separate from financial_audit_log (which tracks money-movement
--   events) to keep concerns and retention policies independent. Today
--   only merchant role flags are tracked; future role-permission writes
--   for other entity types use the same table by varying target_type.
--
-- Immutability
--   A BEFORE UPDATE OR DELETE trigger blocks any mutation — admins can
--   only INSERT new rows. Same defense-in-depth pattern as
--   financial_audit_log (migration 049).
--
-- Idempotency
--   Uses IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS so
--   the migration runner can re-run it safely.

CREATE TABLE IF NOT EXISTS permission_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type     TEXT NOT NULL,        -- 'merchant' (future: 'user', 'compliance_team')
  target_id       UUID NOT NULL,
  permission      TEXT NOT NULL,        -- e.g. 'has_compliance_access', 'has_ops_access'
  previous_value  BOOLEAN,              -- value before change; NULL = unknown / first set
  new_value       BOOLEAN NOT NULL,     -- value after change
  changed_by_type TEXT NOT NULL,        -- 'admin' today
  changed_by_id   TEXT NOT NULL,        -- admin username or actor id
  ip_address      TEXT,
  user_agent      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permission_audit_target
  ON permission_audit_log (target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_permission_audit_actor
  ON permission_audit_log (changed_by_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_permission_audit_permission
  ON permission_audit_log (permission, created_at DESC);

-- Immutability trigger — same pattern as financial_audit_log (migration 049).
CREATE OR REPLACE FUNCTION prevent_permission_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'permission_audit_log is immutable: UPDATE and DELETE are prohibited'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_permission_audit_mutation_trg ON permission_audit_log;
CREATE TRIGGER prevent_permission_audit_mutation_trg
  BEFORE UPDATE OR DELETE ON permission_audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_permission_audit_mutation();
