-- Migration 082: Performance index for chat_messages unread + latest queries
-- The getAllPendingOrdersForMerchant query uses a LATERAL join that counts
-- unread messages and fetches the latest human message for each order.
-- This composite index covers both operations efficiently.

-- Covering index for unread count: includes sender_type and is_read for the
-- COUNT FILTER clause without a table lookup
CREATE INDEX IF NOT EXISTS idx_chat_unread_count
  ON chat_messages (order_id, is_read, sender_type, message_type)
  WHERE is_read = false;
