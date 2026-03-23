-- Migration 044: Add expired_at timestamp to order_receipts.
--
-- The receipt status lifecycle now includes 'expired' as a terminal state
-- alongside 'completed' and 'cancelled'.

ALTER TABLE order_receipts
  ADD COLUMN IF NOT EXISTS expired_at timestamp without time zone;
