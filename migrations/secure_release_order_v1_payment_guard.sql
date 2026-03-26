-- Migration: Enforce payment-sent guard on release_order_v1
-- Date: 2026-03-25
-- Description: Prevents escrow release before payment is sent.
--   1. Restricts release to ONLY 'payment_sent' or 'payment_confirmed' statuses
--   2. Requires payment_sent_at timestamp to be set (double safety)
--   3. Removes 'escrowed', 'payment_pending' from allowed release states
--   4. Preserves existing idempotency and row-locking guarantees
--
-- Why: A malicious or buggy caller could release escrow before the buyer
--      actually sent fiat payment, causing the seller to lose crypto
--      with no payment received. This is the #1 financial loss vector
--      in P2P trading.

-- ─── Replace the 3-param version (called by core-api) ───────────────
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
  -- Lock the order row to prevent concurrent release
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;

  -- ══════════════════════════════════════════════════════════════
  -- GUARD 1: Idempotency — reject if already released
  -- ══════════════════════════════════════════════════════════════
  IF v_order.release_tx_hash IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RELEASED');
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- GUARD 2: Status — ONLY allow release after payment is sent
  --   'payment_sent'      = buyer marked payment as sent
  --   'payment_confirmed'  = seller confirmed payment received
  --   'releasing'          = on-chain release already initiated
  --
  --   BLOCKED: pending, accepted, escrowed, payment_pending
  --   These are all pre-payment states where release = financial loss
  -- ══════════════════════════════════════════════════════════════
  IF v_old_status NOT IN ('payment_sent', 'payment_confirmed', 'releasing') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PAYMENT_NOT_SENT',
      'message', format('Cannot release escrow from status ''%s''. Payment must be sent first.', v_old_status)
    );
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- GUARD 3: Timestamp — payment_sent_at MUST exist
  --   Even if status was somehow set without the timestamp,
  --   we require the actual timestamp as a double safety check.
  -- ══════════════════════════════════════════════════════════════
  IF v_order.payment_sent_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PAYMENT_TIMESTAMP_MISSING',
      'message', 'Payment has not been marked as sent (payment_sent_at is NULL)'
    );
  END IF;

  -- All guards passed — proceed with release

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


-- ─── Replace the 4-param version (used by settle app) ───────────────
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

  -- ══════════════════════════════════════════════════════════════
  -- GUARD 1: Idempotency — already released
  -- ══════════════════════════════════════════════════════════════
  IF v_order.release_tx_hash IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RELEASED');
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- GUARD 2: Status — ONLY after payment is sent
  -- ══════════════════════════════════════════════════════════════
  IF v_old_status NOT IN ('payment_sent', 'payment_confirmed', 'releasing') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PAYMENT_NOT_SENT',
      'message', format('Cannot release escrow from status ''%s''. Payment must be sent first.', v_old_status)
    );
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- GUARD 3: Timestamp — payment_sent_at MUST exist
  -- ══════════════════════════════════════════════════════════════
  IF v_order.payment_sent_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PAYMENT_TIMESTAMP_MISSING',
      'message', 'Payment has not been marked as sent (payment_sent_at is NULL)'
    );
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
