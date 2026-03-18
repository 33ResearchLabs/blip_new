-- Migration 036: Fix accept_order_v1 stored procedure
-- Fixes: when a claiming merchant takes merchant_id, the original creator
-- is preserved as buyer_merchant_id (was being lost before)

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
  v_order_type VARCHAR;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;
  v_order_type := v_order.type::TEXT;

  -- Validate transition: accept only from pending or escrowed
  IF v_order.status NOT IN ('pending'::order_status, 'escrowed'::order_status) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Invalid transition from ' || v_order.status || ' to accepted');
  END IF;

  -- Idempotency: already accepted
  IF v_order.status = 'accepted'::order_status OR v_order.accepted_at IS NOT NULL THEN
    IF v_order.buyer_merchant_id = p_actor_id OR v_order.merchant_id = p_actor_id THEN
      RETURN jsonb_build_object('success', true, 'old_status', v_old_status, 'order', row_to_json(v_order));
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_ACCEPTED');
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

  v_is_m2m := v_is_claiming;

  -- If accepting an already-escrowed order, keep status as escrowed
  v_effective_status := 'accepted'::order_status;
  IF v_order.status = 'escrowed'::order_status AND v_order.escrow_tx_hash IS NOT NULL THEN
    v_effective_status := 'escrowed'::order_status;
  END IF;

  IF v_is_claiming AND v_order.escrow_tx_hash IS NOT NULL AND v_order.buyer_merchant_id IS NULL THEN
    -- Escrowed order being claimed by new merchant: acceptor becomes buyer
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      buyer_merchant_id = p_actor_id,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;

  ELSIF v_is_claiming AND v_order.buyer_merchant_id IS NULL THEN
    -- Non-escrowed order claimed by new merchant:
    -- The acceptor becomes merchant_id (seller role).
    -- The original merchant_id (creator) becomes buyer_merchant_id.
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      buyer_merchant_id = v_order.merchant_id,
      merchant_id = p_actor_id,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;

  ELSIF v_is_m2m AND v_order.buyer_merchant_id IS NOT NULL THEN
    -- M2M: buyer already set, acceptor takes merchant_id (seller)
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      merchant_id = p_actor_id,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;

  ELSE
    -- Simple accept (same merchant / user-initiated order)
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;
  END IF;

  -- Safety net: block self-referencing result
  IF v_updated.merchant_id = v_updated.buyer_merchant_id THEN
    RAISE EXCEPTION 'Self-referencing order detected after accept (merchant_id = buyer_merchant_id). Rolling back.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'order', row_to_json(v_updated)
  );
END;
$$ LANGUAGE plpgsql;
