-- Migration 099: Extend payment_method enum with missing types
--
-- The orders.payment_method column uses a DB enum that only had {bank, cash}.
-- merchant_payment_methods and the Zod schema already allow card, mobile, upi, crypto, other.
-- This caused "invalid input value for enum payment_method: mobile" errors.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction, so we use the
-- drop-and-recreate approach: convert columns to TEXT, drop old enum,
-- create new enum with all values, convert back.

-- Step 1: Drop dependent view
DROP VIEW IF EXISTS v_order_book;

-- Step 2: Convert columns from enum to text
ALTER TABLE orders ALTER COLUMN payment_method TYPE TEXT;
ALTER TABLE merchant_offers ALTER COLUMN payment_method TYPE TEXT;

-- Step 3: Drop old enum and recreate with all values
DROP TYPE IF EXISTS payment_method;
CREATE TYPE payment_method AS ENUM ('bank', 'cash', 'card', 'mobile', 'upi', 'crypto', 'other');

-- Step 4: Convert columns back to the new enum
ALTER TABLE orders ALTER COLUMN payment_method TYPE payment_method USING payment_method::payment_method;
ALTER TABLE merchant_offers ALTER COLUMN payment_method TYPE payment_method USING payment_method::payment_method;

-- Step 5: Recreate the view
CREATE OR REPLACE VIEW v_order_book AS
SELECT
  o.id, o.order_number, o.user_id, o.merchant_id, o.offer_id,
  o.type, o.payment_method, o.crypto_amount, o.crypto_currency,
  o.fiat_amount, o.fiat_currency, o.rate, o.platform_fee, o.network_fee,
  o.status, o.escrow_tx_hash, o.escrow_address, o.release_tx_hash,
  o.payment_details, o.created_at, o.accepted_at, o.escrowed_at,
  o.payment_sent_at, o.payment_confirmed_at, o.completed_at,
  o.cancelled_at, o.expires_at, o.cancelled_by, o.cancellation_reason,
  o.buyer_wallet_address, o.is_custom, o.custom_notes, o.premium_percent,
  o.buyer_merchant_id, o.extension_count, o.max_extensions,
  o.extension_requested_by, o.extension_requested_at, o.last_extended_at,
  o.acceptor_wallet_address, o.has_manual_message, o.assigned_compliance_id,
  o.spread_preference, o.protocol_fee_percentage, o.protocol_fee_amount,
  o.merchant_spread_percentage, o.is_auto_cancelled,
  m.display_name AS merchant_name,
  m.rating AS merchant_rating,
  m.total_trades AS merchant_total_trades,
  m.avg_response_time_mins AS merchant_response_time,
  m.wallet_address AS merchant_wallet,
  (CASE WHEN o.spread_preference::text = 'best' THEN 100
        WHEN o.spread_preference::text = 'fastest' THEN 75
        WHEN o.spread_preference::text = 'cheap' THEN 50
        ELSE 0 END)::numeric
  + m.rating * 10::numeric
  + (CASE WHEN m.avg_response_time_mins < 5 THEN 20 ELSE 0 END)::numeric
  AS match_priority_score
FROM orders o
JOIN merchants m ON o.merchant_id = m.id
WHERE o.status = ANY (ARRAY['pending'::order_status, 'escrowed'::order_status])
ORDER BY match_priority_score DESC, o.created_at;
