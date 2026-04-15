-- Migration 089: Add resolved tracking to error_logs
--
-- Admins can mark error-log entries as resolved so the dashboard only
-- shows open/actionable errors. Resolved rows are kept in the table
-- (for audit history) but hidden from the default view.

ALTER TABLE error_logs
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by TEXT;

-- Partial index so "unresolved only" queries are fast, while the default
-- (show-all) query still uses the existing created_at index.
CREATE INDEX IF NOT EXISTS idx_error_logs_unresolved
  ON error_logs (created_at DESC)
  WHERE resolved_at IS NULL;

COMMENT ON COLUMN error_logs.resolved_at IS 'When an admin marked this error as resolved (hides it from default view)';
COMMENT ON COLUMN error_logs.resolved_by IS 'Admin username that resolved the error';
