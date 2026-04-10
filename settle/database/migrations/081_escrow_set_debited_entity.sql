-- Migration 081: Fix escrow_order_v1 to set escrow_debited_entity fields
--
-- Problem: The stored procedure updates order status to 'escrowed' and sets
-- escrow_tx_hash, but does NOT set escrow_debited_entity_type/id/amount/at.
-- These fields are required by the release flow to know who funded escrow.
-- Without them, escrow release fails and orders get stuck.
--
-- Fix: Set escrow_debited_entity fields based on the actor who locked escrow.

CREATE OR REPLACE FUNCTION public.escrow_order_v1(
  p_order_id uuid,
  p_tx_hash character varying,
  p_actor_type character varying,
  p_actor_id uuid,
  p_escrow_address character varying DEFAULT NULL::character varying,
  p_escrow_trade_id bigint DEFAULT NULL::bigint,
  p_escrow_trade_pda character varying DEFAULT NULL::character varying,
  p_escrow_pda character varying DEFAULT NULL::character varying,
  p_escrow_creator_wallet character varying DEFAULT NULL::character varying,
  p_mock_mode boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
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

  -- Mock mode: deduct seller balance from DB
  -- Production mode (on-chain): skip DB balance deduction — chain is source of truth
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

  -- Update order with escrow details + debited entity tracking
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
    -- Track who funded escrow (critical for release + refund flows)
    escrow_debited_entity_type = p_actor_type,
    escrow_debited_entity_id = p_actor_id,
    escrow_debited_amount = v_amount,
    escrow_debited_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_updated;

  -- NOTE: Ledger entry is created by the auto_log_order_ledger trigger
  -- on the orders table when escrow_tx_hash is set. Do NOT call
  -- log_ledger_entry here to avoid duplicate entries.

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'order', row_to_json(v_updated)
  );
END;
$$;

-- Backfill: Fix existing escrowed/completed orders that are missing escrow_debited_entity fields.
-- For orders that have escrow_tx_hash but no escrow_debited_entity_id, infer the seller:
--   - buy order (non-M2M): merchant is seller
--   - sell order (non-M2M): user is seller
--   - M2M (buyer_merchant_id set): merchant_id is always seller
UPDATE orders
SET escrow_debited_entity_type = CASE
      WHEN buyer_merchant_id IS NOT NULL THEN 'merchant'
      WHEN type = 'buy' THEN 'merchant'
      ELSE 'user'
    END,
    escrow_debited_entity_id = CASE
      WHEN buyer_merchant_id IS NOT NULL THEN merchant_id
      WHEN type = 'buy' THEN merchant_id
      ELSE user_id
    END,
    escrow_debited_amount = crypto_amount,
    escrow_debited_at = COALESCE(escrowed_at, created_at)
WHERE escrow_tx_hash IS NOT NULL
  AND escrow_debited_entity_id IS NULL;
