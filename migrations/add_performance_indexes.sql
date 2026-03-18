-- Migration: Add performance indexes
-- Date: 2026-03-14
-- Description: Addresses slow queries found in performance audit.
--   1. Username prefix index for LIKE 'open_order_%' / 'm2m_%' patterns
--   2. Composite index for merchant order OR queries
--   3. Chat messages covering index for unread/latest queries

-- 1. Username prefix index (used in getAllPendingOrdersForMerchant CASE/LIKE)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_username_prefix
  ON users (username varchar_pattern_ops);

-- 2. Buyer merchant + status index (covers OR branch in merchant order queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_buyer_merchant_status
  ON orders (buyer_merchant_id, status) WHERE buyer_merchant_id IS NOT NULL;

-- 3. Chat messages: composite for LATERAL joins (replaces correlated subqueries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_order_human_latest
  ON chat_messages (order_id, created_at DESC)
  WHERE message_type != 'system' AND sender_type != 'system';

-- 4. Orders: created_at for ORDER BY in pending queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at_desc
  ON orders (created_at DESC);

-- 5. Orders: status for filtering active orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status
  ON orders (status) WHERE status NOT IN ('expired', 'cancelled');
