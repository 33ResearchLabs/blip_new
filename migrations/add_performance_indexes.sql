-- Migration: Add performance indexes
-- Date: 2026-03-14
-- Description: Addresses slow queries found in performance audit.
--   1. Username prefix index for LIKE 'open_order_%' / 'm2m_%' patterns
--   2. Composite index for merchant order OR queries
--   3. Chat messages covering index for unread/latest queries
--
-- Runs inside the core-api migration runner's BEGIN/COMMIT block. Postgres
-- forbids CREATE INDEX CONCURRENTLY in a transaction, so we use plain
-- CREATE INDEX here. At current table sizes the AccessExclusive lock
-- during build is sub-second.
--
-- If a table grows large enough that the brief lock becomes operationally
-- unacceptable, an operator may build the index out-of-band with
-- CONCURRENTLY before the deploy runs — the IF NOT EXISTS guard then makes
-- this migration a no-op on next run.
--
-- Safe re-run: every CREATE uses IF NOT EXISTS — running this on a DB that
-- already has the indexes is a no-op.

-- 1. Username prefix index (used in getAllPendingOrdersForMerchant CASE/LIKE)
CREATE INDEX IF NOT EXISTS idx_users_username_prefix
  ON users (username varchar_pattern_ops);

-- 2. Buyer merchant + status index (covers OR branch in merchant order queries)
CREATE INDEX IF NOT EXISTS idx_orders_buyer_merchant_status
  ON orders (buyer_merchant_id, status) WHERE buyer_merchant_id IS NOT NULL;

-- 3. Chat messages: composite for LATERAL joins (replaces correlated subqueries)
CREATE INDEX IF NOT EXISTS idx_chat_messages_order_human_latest
  ON chat_messages (order_id, created_at DESC)
  WHERE message_type != 'system' AND sender_type != 'system';

-- 4. Orders: created_at for ORDER BY in pending queries
CREATE INDEX IF NOT EXISTS idx_orders_created_at_desc
  ON orders (created_at DESC);

-- 5. Orders: status for filtering active orders
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders (status) WHERE status NOT IN ('expired', 'cancelled');
