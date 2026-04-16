-- 093: Rename crypto_currency 'USDC' → 'USDT' across orders.
--
-- Context: on-chain escrow has always used the USDT SPL mint
-- (lib/solana/escrow.ts USDT_MAINNET_MINT/USDT_DEVNET_MINT). The DB column
-- default and stored procedure literal were stuck on 'USDC' from an earlier
-- draft and leaked into UI copy. This migration brings the data layer in
-- line with the actual on-chain asset.
--
-- Idempotent: re-running is a no-op once all rows say 'USDT' and the default
-- is 'USDT'. The CREATE OR REPLACE FUNCTION replays cleanly.

-- 1. Change the column default for new inserts.
ALTER TABLE orders
  ALTER COLUMN crypto_currency SET DEFAULT 'USDT';

-- 2. Backfill existing rows. Only touches rows still tagged 'USDC'.
UPDATE orders
SET crypto_currency = 'USDT'
WHERE crypto_currency = 'USDC';

-- 3. Rewrite create_order_v1 stored procedure so the hot-path insert tags
--    new orders as 'USDT'. Body is identical to migration 032 except for the
--    literal on the VALUES row.
CREATE OR REPLACE FUNCTION create_order_v1(
  p_user_id UUID,
  p_merchant_id UUID,
  p_offer_id UUID,
  p_type VARCHAR,
  p_payment_method VARCHAR,
  p_crypto_amount DECIMAL,
  p_fiat_amount DECIMAL,
  p_rate DECIMAL,
  p_payment_details JSONB DEFAULT NULL,
  p_buyer_wallet_address VARCHAR DEFAULT NULL,
  p_buyer_merchant_id UUID DEFAULT NULL,
  p_spread_preference VARCHAR DEFAULT NULL,
  p_protocol_fee_percentage DECIMAL DEFAULT NULL,
  p_protocol_fee_amount DECIMAL DEFAULT NULL,
  p_escrow_tx_hash VARCHAR DEFAULT NULL,
  p_escrow_trade_id BIGINT DEFAULT NULL,
  p_escrow_trade_pda VARCHAR DEFAULT NULL,
  p_escrow_pda VARCHAR DEFAULT NULL,
  p_escrow_creator_wallet VARCHAR DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_order RECORD;
  v_status order_status;
BEGIN
  UPDATE merchant_offers
  SET available_amount = available_amount - p_crypto_amount,
      updated_at = NOW()
  WHERE id = (
    SELECT id FROM merchant_offers WHERE id = p_offer_id AND available_amount >= p_crypto_amount FOR UPDATE
  );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_LIQUIDITY');
  END IF;

  v_status := CASE WHEN p_escrow_tx_hash IS NOT NULL THEN 'escrowed'::order_status ELSE 'pending'::order_status END;

  INSERT INTO orders (
    user_id, merchant_id, offer_id, type, payment_method,
    crypto_amount, fiat_amount, crypto_currency, fiat_currency, rate,
    payment_details, status, expires_at,
    buyer_wallet_address, buyer_merchant_id,
    spread_preference, protocol_fee_percentage, protocol_fee_amount,
    escrow_tx_hash, escrowed_at,
    escrow_trade_id, escrow_trade_pda, escrow_pda, escrow_creator_wallet
  ) VALUES (
    p_user_id, p_merchant_id, p_offer_id, p_type::offer_type, p_payment_method::payment_method,
    p_crypto_amount, p_fiat_amount, 'USDT', 'AED', p_rate,
    p_payment_details, v_status, NOW() + INTERVAL '15 minutes',
    p_buyer_wallet_address, p_buyer_merchant_id,
    p_spread_preference, p_protocol_fee_percentage, p_protocol_fee_amount,
    p_escrow_tx_hash,
    CASE WHEN p_escrow_tx_hash IS NOT NULL THEN NOW() ELSE NULL END,
    p_escrow_trade_id, p_escrow_trade_pda, p_escrow_pda, p_escrow_creator_wallet
  ) RETURNING * INTO v_order;

  RETURN jsonb_build_object(
    'success', true,
    'order', row_to_json(v_order)
  );
END;
$$ LANGUAGE plpgsql;
