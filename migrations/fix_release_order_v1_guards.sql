-- Migration: Add idempotency and status guards to release_order_v1
-- Date: 2026-03-14
-- Description: Prevents double-release (double credit) and release from invalid statuses.
--              Without these guards, calling release twice credits the buyer twice.

CREATE OR REPLACE FUNCTION release_order_v1(
  p_order_id UUID,
  p_release_tx_hash TEXT,
  p_released_by_entity_type TEXT,
  p_released_by_entity_id UUID
) RETURNS jsonb AS $$
DECLARE
  v_order RECORD;
  v_old_status TEXT;
  v_payee_id UUID;
  v_payee_type TEXT;
  v_amount NUMERIC;
BEGIN
  -- Lock the order row
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  v_old_status := v_order.status;

  -- Idempotency: already released
  IF v_order.release_tx_hash IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RELEASED');
  END IF;

  -- Status guard: only allow release from valid states
  IF v_old_status NOT IN ('payment_confirmed', 'releasing', 'escrowed', 'payment_sent', 'payment_pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  END IF;

  -- Determine payee (buyer)
  v_amount := v_order.amount;
  IF v_order.buyer_merchant_id IS NOT NULL THEN
    v_payee_id := v_order.buyer_merchant_id;
    v_payee_type := 'merchant';
  ELSE
    v_payee_id := v_order.user_id;
    v_payee_type := 'user';
  END IF;

  -- Credit buyer balance
  IF v_payee_type = 'merchant' THEN
    UPDATE merchants SET balance = balance + v_amount WHERE id = v_payee_id;
  ELSE
    UPDATE users SET balance = balance + v_amount WHERE id = v_payee_id;
  END IF;

  -- Update order
  UPDATE orders SET
    status = 'completed',
    release_tx_hash = p_release_tx_hash,
    released_at = NOW(),
    updated_at = NOW()
  WHERE id = p_order_id;

  -- Insert ledger entry
  INSERT INTO ledger_entries (order_id, entry_type, amount, entity_type, entity_id, tx_hash, created_at)
  VALUES (p_order_id, 'escrow_release', v_amount, v_payee_type, v_payee_id, p_release_tx_hash, NOW());

  -- Insert order event
  INSERT INTO order_events (order_id, event_type, old_status, new_status, actor_type, actor_id, metadata, created_at)
  VALUES (p_order_id, 'release', v_old_status, 'completed', p_released_by_entity_type, p_released_by_entity_id,
    jsonb_build_object('tx_hash', p_release_tx_hash, 'amount', v_amount, 'payee_type', v_payee_type, 'payee_id', v_payee_id),
    NOW());

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'new_status', 'completed',
    'amount', v_amount,
    'payee_type', v_payee_type,
    'payee_id', v_payee_id
  );
END;
$$ LANGUAGE plpgsql;
