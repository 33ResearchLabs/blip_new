-- Centralized error + business-anomaly log table.
-- PURELY ADDITIVE: no changes to any existing table.
-- Populated by the opt-in error tracking system (see /lib/errorTracking/).
-- Gated end-to-end by the ENABLE_ERROR_TRACKING env flag on the server.

CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Short, machine-readable classification (e.g. "api.500", "ui.crash",
  -- "order.stuck", "timer.mismatch", "chat.undelivered", "escrow.state_mismatch")
  type VARCHAR(100) NOT NULL,
  -- Human-readable summary (≤ 2000 chars; longer detail lives in metadata)
  message TEXT NOT NULL,
  -- Normalized severity
  severity VARCHAR(16) NOT NULL DEFAULT 'ERROR'
    CHECK (severity IN ('INFO', 'WARN', 'ERROR', 'CRITICAL')),
  -- Optional correlation identifiers — nullable so non-order-scoped errors
  -- (e.g. page crashes, auth failures) still fit
  order_id UUID,
  user_id UUID,
  merchant_id UUID,
  -- Where the log originated
  source VARCHAR(16) NOT NULL DEFAULT 'backend'
    CHECK (source IN ('frontend', 'backend', 'worker')),
  -- Structured context: stack, URL, user agent, extra business fields, etc.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for the admin dashboard's common filter combinations.
-- All partial / btree, never CONCURRENTLY (core-api wraps migrations in a txn).
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at
  ON error_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_severity_created
  ON error_logs (severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_type_created
  ON error_logs (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_order
  ON error_logs (order_id, created_at DESC)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_error_logs_user
  ON error_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_error_logs_merchant
  ON error_logs (merchant_id, created_at DESC)
  WHERE merchant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_error_logs_source
  ON error_logs (source, created_at DESC);
