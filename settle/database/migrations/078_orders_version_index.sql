-- ============================================================================
-- 078_orders_version_index.sql
--
-- ADDITIVE — single composite index on orders(id, order_version).
--
-- Used by:
--   * notification_outbox worker — stale-version filter joins orders by id and
--     compares order_version against the snapshot in the outbox payload.
--   * Optimistic locking UPDATEs that include both predicates.
--
-- This is the ONLY change to the orders table in the realtime stabilization
-- rollout. No columns added. No constraints added. No data modified.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_orders_id_version;
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_orders_id_version
  ON orders (id, order_version);

COMMIT;
