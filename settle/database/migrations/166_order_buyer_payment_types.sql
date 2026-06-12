-- Migration 166: buyer's accepted payment method types on BUY orders.
--
-- A buy order's buyer chooses one OR MORE payment rails they can pay with
-- (e.g. {bank,upi}). Two downstream uses:
--   1. The order is shown only to merchants who support at least one of these
--      types (merchant order-feed filter, via array overlap `&&`).
--   2. After a merchant accepts, the buyer pays into the merchant's matching
--      payment method(s).
--
-- Backward-compatible: nullable, no default. Existing rows (and all SELL
-- orders) keep NULL. Idempotent so it re-runs safely on every startup.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS buyer_payment_types TEXT[];

COMMENT ON COLUMN orders.buyer_payment_types IS
  'BUY orders: list of payment method types the buyer can pay with (e.g. {bank,upi}). NULL for sell/legacy orders.';

-- GIN index supports the merchant-feed overlap query (`buyer_payment_types && $1`)
-- without scanning every open order. Partial: only buy orders carry the column.
CREATE INDEX IF NOT EXISTS idx_orders_buyer_payment_types
  ON orders USING GIN (buyer_payment_types)
  WHERE buyer_payment_types IS NOT NULL;
