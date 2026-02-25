-- 032: Stored procedures for hot-path lifecycle operations
-- Eliminates N round-trips per lifecycle step by running full TX logic inside PG.
-- Returns JSONB with {success, old_status, order} to avoid composite type hassles.

--------------------------------------------------------------------------------
-- 1. create_order_v1: Deduct offer + insert order atomically (2 round-trips → 1)
--------------------------------------------------------------------------------
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
  -- Deduct offer liquidity (row lock held until function returns)
  UPDATE merchant_offers
  SET available_amount = available_amount - p_crypto_amount
  WHERE id = p_offer_id AND available_amount >= p_crypto_amount;

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
    p_crypto_amount, p_fiat_amount, 'USDC', 'AED', p_rate,
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


--------------------------------------------------------------------------------
-- 2. accept_order_v1: FOR UPDATE + validate + update (4 round-trips → 1)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_order_v1(
  p_order_id UUID,
  p_actor_type VARCHAR,
  p_actor_id UUID,
  p_acceptor_wallet_address VARCHAR DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_order RECORD;
  v_old_status VARCHAR;
  v_updated RECORD;
  v_effective_status order_status;
  v_username VARCHAR;
  v_is_claiming BOOLEAN;
  v_is_m2m BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;

  -- Validate transition: accept only from pending or escrowed
  IF v_order.status NOT IN ('pending'::order_status, 'escrowed'::order_status) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Invalid transition from ' || v_order.status || ' to accepted');
  END IF;

  -- Idempotency
  IF v_order.status = 'accepted'::order_status THEN
    RETURN jsonb_build_object('success', true, 'old_status', v_old_status, 'order', row_to_json(v_order));
  END IF;

  -- Block self-acceptance of merchant-initiated orders
  IF p_actor_type = 'merchant' AND v_order.merchant_id = p_actor_id THEN
    SELECT username INTO v_username FROM users WHERE id = v_order.user_id;
    IF v_username LIKE 'open_order_%' OR v_username LIKE 'm2m_%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot accept your own order');
    END IF;
  END IF;

  v_is_claiming := (p_actor_type = 'merchant'
    AND v_order.status IN ('pending'::order_status, 'escrowed'::order_status)
    AND v_order.merchant_id != p_actor_id);

  v_is_m2m := (p_actor_type = 'merchant'
    AND v_order.status IN ('escrowed'::order_status, 'pending'::order_status)
    AND v_order.merchant_id != p_actor_id);

  -- If accepting an already-escrowed order, keep status as escrowed
  v_effective_status := 'accepted'::order_status;
  IF v_order.status = 'escrowed'::order_status AND v_order.escrow_tx_hash IS NOT NULL THEN
    v_effective_status := 'escrowed'::order_status;
  END IF;

  -- Build UPDATE dynamically based on claiming/m2m logic
  IF (v_is_claiming OR v_is_m2m) AND v_order.escrow_tx_hash IS NOT NULL AND v_order.buyer_merchant_id IS NULL THEN
    -- Escrowed order being claimed: acceptor becomes buyer
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      buyer_merchant_id = p_actor_id,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;
  ELSIF v_is_claiming OR (v_is_m2m AND v_order.buyer_merchant_id IS NOT NULL) THEN
    -- Claiming: acceptor becomes merchant
    -- For merchant-created orders (placeholder user), preserve the creating merchant as buyer_merchant_id
    SELECT username INTO v_username FROM users WHERE id = v_order.user_id;
    IF (v_username LIKE 'open_order_%' OR v_username LIKE 'm2m_%') AND v_order.buyer_merchant_id IS NULL THEN
      UPDATE orders SET
        status = v_effective_status,
        accepted_at = NOW(),
        expires_at = NOW() + INTERVAL '120 minutes',
        order_version = order_version + 1,
        buyer_merchant_id = v_order.merchant_id,
        merchant_id = p_actor_id,
        acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
      WHERE id = p_order_id RETURNING * INTO v_updated;
    ELSE
      UPDATE orders SET
        status = v_effective_status,
        accepted_at = NOW(),
        expires_at = NOW() + INTERVAL '120 minutes',
        order_version = order_version + 1,
        merchant_id = p_actor_id,
        acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
      WHERE id = p_order_id RETURNING * INTO v_updated;
    END IF;
  ELSIF v_is_m2m AND v_order.buyer_merchant_id IS NULL THEN
    -- M2M: acceptor becomes buyer
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      buyer_merchant_id = p_actor_id,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;
  ELSE
    -- Simple accept (same merchant, no reassignment)
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'order', row_to_json(v_updated)
  );
END;
$$ LANGUAGE plpgsql;


--------------------------------------------------------------------------------
-- 3. escrow_order_v1: FOR UPDATE + validate + deduct balance + update (4 round-trips → 1)
--------------------------------------------------------------------------------
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
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;

  IF v_order.status NOT IN ('pending'::order_status, 'accepted'::order_status, 'escrow_pending'::order_status) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_STATUS_CHANGED');
  END IF;

  IF v_order.escrow_tx_hash IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_ESCROWED');
  END IF;

  v_amount := v_order.crypto_amount;

  -- Mock mode: deduct seller balance
  IF p_mock_mode THEN
    IF p_actor_type = 'merchant' THEN
      UPDATE merchants SET balance = balance - v_amount
      WHERE id = p_actor_id AND balance >= v_amount;
    ELSE
      UPDATE users SET balance = balance - v_amount
      WHERE id = p_actor_id AND balance >= v_amount;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    END IF;
  END IF;

  -- Update order with escrow details
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
    order_version = order_version + 1
  WHERE id = p_order_id
  RETURNING * INTO v_updated;

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'order', row_to_json(v_updated)
  );
END;
$$ LANGUAGE plpgsql;


--------------------------------------------------------------------------------
-- 4. release_order_v1: FOR UPDATE + update + credit balance (5 round-trips → 1)
--------------------------------------------------------------------------------
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
  v_is_buy BOOLEAN;
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

  -- Mock mode: credit recipient balance
  IF p_mock_mode THEN
    v_amount := v_order.crypto_amount;
    v_is_buy := (v_order.type = 'buy'::offer_type);

    IF v_is_buy THEN
      IF v_order.buyer_merchant_id IS NOT NULL THEN
        v_recipient_id := v_order.buyer_merchant_id;
        v_recipient_table := 'merchants';
      ELSE
        v_recipient_id := v_order.user_id;
        v_recipient_table := 'users';
      END IF;
    ELSE
      IF v_order.buyer_merchant_id IS NOT NULL THEN
        v_recipient_id := v_order.buyer_merchant_id;
      ELSE
        v_recipient_id := v_order.merchant_id;
      END IF;
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
