-- Fix escrow_trade_id column type from integer to bigint
-- This allows storing large timestamp values from Date.now()
--
-- Must drop dependent views/functions first, then recreate after ALTER.
-- PostgreSQL does not allow ALTER TYPE on a column referenced by a view.

-- 1. Drop dependent function first (it references the view)
DROP FUNCTION IF EXISTS get_matching_orders(VARCHAR, VARCHAR, DECIMAL, VARCHAR, INTEGER);

-- 2. Drop the view that depends on orders.*
DROP VIEW IF EXISTS v_order_book;

-- 3. Also drop the messages view if it depends on orders (from migration 002)
--    (it doesn't, but safety)

-- 4. Change column type to BIGINT
ALTER TABLE orders
ALTER COLUMN escrow_trade_id TYPE BIGINT;

-- 5. Recreate the view (from migration 017)
CREATE OR REPLACE VIEW v_order_book AS
SELECT
  o.*,
  m.display_name as merchant_name,
  m.rating as merchant_rating,
  m.total_trades as merchant_total_trades,
  m.avg_response_time_mins as merchant_response_time,
  m.wallet_address as merchant_wallet,
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

-- 6. Recreate the dependent function (from migration 017)
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
    AND v.crypto_amount >= p_crypto_amount * 0.9
    AND v.crypto_amount <= p_crypto_amount * 1.1
    AND v.merchant_id != p_exclude_merchant_id
    AND v.status IN ('pending', 'escrowed')
  ORDER BY v.match_priority_score DESC, v.created_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- 7. Verify the change
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'orders'
      AND column_name = 'escrow_trade_id'
      AND data_type = 'bigint'
  ) THEN
    RAISE NOTICE 'SUCCESS: escrow_trade_id is now BIGINT';
  ELSE
    RAISE EXCEPTION 'FAILED: escrow_trade_id is still not BIGINT';
  END IF;
END $$;
