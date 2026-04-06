-- Security hardening: prevent double-claim at DB level + add missing indexes
-- Safe to run on existing data (additive only, no destructive changes)

-- Prevent two merchants from claiming the same order (defense-in-depth)
-- The application already uses FOR UPDATE + IS NULL checks, but this is a safety net.
CREATE INDEX IF NOT EXISTS idx_orders_buyer_merchant_active
  ON orders (buyer_merchant_id, status, created_at DESC)
  WHERE buyer_merchant_id IS NOT NULL AND status NOT IN ('expired', 'cancelled');

-- Missing index for M2M buyer queries (currently full table scan)
CREATE INDEX IF NOT EXISTS idx_orders_buyer_merchant_lookup
  ON orders (buyer_merchant_id) WHERE buyer_merchant_id IS NOT NULL;

-- Missing index for merchant offers lookup by type + payment method
CREATE INDEX IF NOT EXISTS idx_merchant_offers_lookup
  ON merchant_offers (type, payment_method, min_amount, max_amount)
  WHERE is_active = true;
