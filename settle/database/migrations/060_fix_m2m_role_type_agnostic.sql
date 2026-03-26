-- Migration 060: Fix M2M role assignment to be type-agnostic
--
-- BUG: Migration 059 assumed stored type affects M2M roles:
--   Stored 'buy'  → buyer_merchant_id is seller (WRONG)
--   Stored 'sell' → merchant_id is seller
--
-- CORRECT RULE (matches SQL role queries in orders.ts):
--   M2M: merchant_id is ALWAYS the seller, buyer_merchant_id is ALWAYS the buyer.
--   Stored type does NOT affect M2M role assignment.
--
-- This fixes both escrow_order_v1 (seller/lock) and release_order_v1 (buyer/recipient).

-- ═══════════════════════════════════════════════════════════════════════
-- FIX 1: escrow_order_v1 — seller determination for escrow lock
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION escrow_order_v1(
  p_order_id UUID,
  p_tx_hash VARCHAR,
  p_actor_type VARCHAR,
  p_actor_id UUID,
  p_escrow_address VARCHAR DEFAULT NULL,
  p_escrow_trade_id BIGINT DEFAULT NULL,
  p_escrow_trade_pda VARCHAR DEFAULT NULL,
  p_escrow_pda VARCHAR DEFAULT NULL,
  p_escrow_creator_wallet VARCHAR DEFAULT NULL,
  p_mock_mode BOOLEAN DEFAULT false
) RETURNS JSONB AS $$
DECLARE
  v_order RECORD;
  v_old_status VARCHAR;
  v_amount DECIMAL;
  v_updated RECORD;
  v_seller_id UUID;
  v_seller_type VARCHAR;  -- 'merchant' or 'user'
BEGIN
  -- 1. Lock order row
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;

  -- 2. Status guard
  IF v_order.status NOT IN ('pending'::order_status, 'accepted'::order_status, 'escrow_pending'::order_status) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_STATUS_CHANGED');
  END IF;

  -- 3. Idempotency: already escrowed
  IF v_order.escrow_tx_hash IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_ESCROWED');
  END IF;

  v_amount := v_order.crypto_amount;

  -- 4. Determine the correct seller
  --    M2M: merchant_id is ALWAYS the seller (type-agnostic)
  --    Non-M2M buy: merchant_id is seller
  --    Non-M2M sell: user_id is seller
  IF v_order.buyer_merchant_id IS NOT NULL THEN
    -- M2M: merchant_id = seller, buyer_merchant_id = buyer. Always.
    v_seller_id := v_order.merchant_id;
    v_seller_type := 'merchant';
  ELSIF v_order.type = 'buy'::offer_type THEN
    v_seller_id := v_order.merchant_id;
    v_seller_type := 'merchant';
  ELSE
    v_seller_id := v_order.user_id;
    v_seller_type := 'user';
  END IF;

  -- 5. Validate: caller must be the seller
  IF p_actor_id != v_seller_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'WRONG_ESCROW_PARTY',
      'detail', 'Only the seller can lock escrow. Expected ' || v_seller_type || ' ' || v_seller_id::TEXT
                || ', got ' || p_actor_type || ' ' || p_actor_id::TEXT
    );
  END IF;

  -- 6. Mock mode: deduct from the correct seller
  IF p_mock_mode THEN
    IF v_seller_type = 'merchant' THEN
      UPDATE merchants SET balance = balance - v_amount
      WHERE id = v_seller_id AND balance >= v_amount;
    ELSE
      UPDATE users SET balance = balance - v_amount
      WHERE id = v_seller_id AND balance >= v_amount;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    END IF;
  END IF;

  -- 7. Update order with escrow details + record who was debited
  UPDATE orders SET
    escrow_tx_hash = p_tx_hash,
    escrow_address = p_escrow_address,
    escrow_trade_id = p_escrow_trade_id,
    escrow_trade_pda = p_escrow_trade_pda,
    escrow_pda = p_escrow_pda,
    escrow_creator_wallet = p_escrow_creator_wallet,
    escrowed_at = NOW(),
    expires_at = NOW() + INTERVAL '120 minutes',
    status = 'escrowed'::order_status,
    order_version = order_version + 1,
    escrow_debited_entity_type = v_seller_type,
    escrow_debited_entity_id = v_seller_id,
    escrow_debited_amount = v_amount,
    escrow_debited_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_updated;

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'order', row_to_json(v_updated)
  );
END;
$$ LANGUAGE plpgsql;


-- ═══════════════════════════════════════════════════════════════════════
-- FIX 2: release_order_v1 — buyer/recipient determination for release
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION release_order_v1(
  p_order_id UUID,
  p_tx_hash VARCHAR,
  p_mock_mode BOOLEAN DEFAULT false
) RETURNS JSONB AS $$
DECLARE
  v_order RECORD;
  v_old_status VARCHAR;
  v_updated RECORD;
  v_amount DECIMAL;
  v_recipient_id UUID;
  v_recipient_table VARCHAR;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;

  -- Update order to completed
  UPDATE orders SET
    status = 'completed'::order_status,
    release_tx_hash = p_tx_hash,
    completed_at = NOW(),
    payment_confirmed_at = COALESCE(payment_confirmed_at, NOW()),
    order_version = order_version + 1
  WHERE id = p_order_id
  RETURNING * INTO v_updated;

  -- Mock mode: credit recipient (buyer) balance
  IF p_mock_mode THEN
    v_amount := v_order.crypto_amount;

    -- Buyer determination:
    --   M2M: buyer_merchant_id is ALWAYS the buyer (type-agnostic)
    --   Non-M2M buy: user_id is the buyer
    --   Non-M2M sell: merchant_id is the buyer
    IF v_order.buyer_merchant_id IS NOT NULL THEN
      -- M2M: buyer_merchant_id = buyer. Always.
      v_recipient_id := v_order.buyer_merchant_id;
      v_recipient_table := 'merchants';
    ELSIF v_order.type = 'buy'::offer_type THEN
      v_recipient_id := v_order.user_id;
      v_recipient_table := 'users';
    ELSE
      v_recipient_id := v_order.merchant_id;
      v_recipient_table := 'merchants';
    END IF;

    IF v_recipient_table = 'merchants' THEN
      UPDATE merchants SET balance = balance + v_amount WHERE id = v_recipient_id;
    ELSE
      UPDATE users SET balance = balance + v_amount WHERE id = v_recipient_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'order', row_to_json(v_updated)
  );
END;
$$ LANGUAGE plpgsql;
