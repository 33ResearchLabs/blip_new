-- Migration: Add spread preference and protocol fee system
-- This enables tiered pricing: Best (2%), Fastest (2.5%), Cheap (1.5%)
-- Orders remain open indefinitely (no auto-expire for pending)

-- Add spread preference and protocol fee fields
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS spread_preference VARCHAR(20) DEFAULT 'fastest',
  ADD COLUMN IF NOT EXISTS protocol_fee_percentage DECIMAL(5,2) DEFAULT 2.50,
  ADD COLUMN IF NOT EXISTS protocol_fee_amount DECIMAL(20,8),
  ADD COLUMN IF NOT EXISTS merchant_spread_percentage DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS is_auto_cancelled BOOLEAN DEFAULT FALSE;

-- Add check constraint for spread preference values
ALTER TABLE orders
  ADD CONSTRAINT check_spread_preference
  CHECK (spread_preference IN ('best', 'fastest', 'cheap'));

-- Add indices for matching engine
CREATE INDEX IF NOT EXISTS idx_orders_matching
  ON orders(status, type, payment_method, spread_preference, created_at);

CREATE INDEX IF NOT EXISTS idx_orders_spread_ranking
  ON orders(spread_preference, created_at)
  WHERE status = 'pending';

-- Create view for order book with spread priority
CREATE OR REPLACE VIEW v_order_book AS
SELECT
  o.*,
  m.display_name as merchant_name,
  m.rating as merchant_rating,
  m.total_trades as merchant_total_trades,
  m.avg_response_time_mins as merchant_response_time,
  m.wallet_address as merchant_wallet,
  -- Calculate priority score for matching
  CASE
    WHEN o.spread_preference = 'best' THEN 100
    WHEN o.spread_preference = 'fastest' THEN 75
    WHEN o.spread_preference = 'cheap' THEN 50
    ELSE 0
  END +
  (m.rating * 10) +
  (CASE WHEN m.avg_response_time_mins < 5 THEN 20 ELSE 0 END) as match_priority_score
FROM orders o
JOIN merchants m ON o.merchant_id = m.id
WHERE o.status IN ('pending', 'escrowed')
ORDER BY match_priority_score DESC, o.created_at ASC;

-- Create function to calculate protocol fee based on spread preference
CREATE OR REPLACE FUNCTION calculate_protocol_fee(
  p_crypto_amount DECIMAL,
  p_spread_preference VARCHAR
) RETURNS TABLE (
  fee_percentage DECIMAL,
  fee_amount DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN p_spread_preference = 'best' THEN 2.00
      WHEN p_spread_preference = 'fastest' THEN 2.50
      WHEN p_spread_preference = 'cheap' THEN 1.50
      ELSE 2.50 -- default to fastest
    END::DECIMAL(5,2) as fee_percentage,
    (p_crypto_amount *
      CASE
        WHEN p_spread_preference = 'best' THEN 0.02
        WHEN p_spread_preference = 'fastest' THEN 0.025
        WHEN p_spread_preference = 'cheap' THEN 0.015
        ELSE 0.025
      END
    )::DECIMAL(20,8) as fee_amount;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create function to get matching orders for a given order
CREATE OR REPLACE FUNCTION get_matching_orders(
  p_order_type VARCHAR,
  p_payment_method VARCHAR,
  p_crypto_amount DECIMAL,
  p_exclude_merchant_id VARCHAR,
  p_limit INTEGER DEFAULT 10
) RETURNS TABLE (
  order_id VARCHAR,
  merchant_id VARCHAR,
  merchant_name VARCHAR,
  merchant_rating DECIMAL,
  merchant_total_trades INTEGER,
  merchant_wallet VARCHAR,
  crypto_amount DECIMAL,
  rate DECIMAL,
  spread_preference VARCHAR,
  match_priority_score INTEGER,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.id,
    v.merchant_id,
    v.merchant_name,
    v.merchant_rating,
    v.merchant_total_trades,
    v.merchant_wallet,
    v.crypto_amount,
    v.rate,
    v.spread_preference,
    v.match_priority_score,
    v.created_at
  FROM v_order_book v
  WHERE v.type = (CASE WHEN p_order_type = 'buy' THEN 'sell' ELSE 'buy' END)
    AND v.payment_method = p_payment_method
    AND v.crypto_amount >= p_crypto_amount * 0.9  -- Allow 10% variance
    AND v.crypto_amount <= p_crypto_amount * 1.1
    AND v.merchant_id != p_exclude_merchant_id
    AND v.status IN ('pending', 'escrowed')
  ORDER BY v.match_priority_score DESC, v.created_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Backfill existing orders with default spread preference
UPDATE orders
SET
  spread_preference = 'fastest',
  protocol_fee_percentage = 2.50
WHERE spread_preference IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN orders.spread_preference IS 'Tier selection: best (2%), fastest (2.5%), cheap (1.5%) - determines protocol fee and match priority';
COMMENT ON COLUMN orders.protocol_fee_percentage IS 'Protocol fee percentage based on spread preference';
COMMENT ON COLUMN orders.protocol_fee_amount IS 'Actual protocol fee amount in USDC';
COMMENT ON COLUMN orders.merchant_spread_percentage IS 'Merchant profit spread percentage (total spread - protocol fee)';
