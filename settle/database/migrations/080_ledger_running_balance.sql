-- Migration 080: Add running balance tracking to ledger entries
-- Updates log_ledger_entry() to calculate balance_before and balance_after
-- from the merchant/user balance at time of entry.

CREATE OR REPLACE FUNCTION public.log_ledger_entry(
  p_account_type character varying,
  p_account_id uuid,
  p_entry_type character varying,
  p_amount numeric,
  p_asset character varying DEFAULT 'USDT'::character varying,
  p_related_order_id uuid DEFAULT NULL::uuid,
  p_related_tx_hash character varying DEFAULT NULL::character varying,
  p_description text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id UUID;
  v_balance_before NUMERIC(20,8);
  v_balance_after NUMERIC(20,8);
BEGIN
  -- Get current balance from the entity's table
  IF p_account_type = 'merchant' THEN
    SELECT COALESCE(balance, 0) INTO v_balance_before
    FROM merchants WHERE id = p_account_id;
  ELSIF p_account_type = 'user' THEN
    SELECT COALESCE(balance, 0) INTO v_balance_before
    FROM users WHERE id = p_account_id;
  ELSE
    v_balance_before := 0;
  END IF;

  v_balance_after := v_balance_before + p_amount;

  INSERT INTO ledger_entries (
    account_type,
    account_id,
    entry_type,
    amount,
    asset,
    related_order_id,
    related_tx_hash,
    description,
    metadata,
    idempotency_key,
    balance_before,
    balance_after
  ) VALUES (
    p_account_type,
    p_account_id,
    p_entry_type,
    p_amount,
    p_asset,
    p_related_order_id,
    p_related_tx_hash,
    p_description,
    p_metadata,
    p_idempotency_key,
    v_balance_before,
    v_balance_after
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$;

-- Backfill existing ledger entries with balance_before/balance_after
-- Processes entries forward (chronologically) per account, starting from 0.
-- This is a one-time backfill; new entries will be populated by the updated function.
DO $$
DECLARE
  r RECORD;
  v_running_balance NUMERIC(20,8) := 0;
  v_account_key TEXT;
  v_prev_key TEXT := '';
BEGIN
  FOR r IN
    SELECT le.id, le.account_type, le.account_id, le.amount
    FROM ledger_entries le
    ORDER BY le.account_type, le.account_id, le.created_at ASC
  LOOP
    v_account_key := r.account_type || ':' || r.account_id;

    IF v_account_key != v_prev_key THEN
      v_running_balance := 0;
      v_prev_key := v_account_key;
    END IF;

    UPDATE ledger_entries
    SET balance_before = v_running_balance,
        balance_after = v_running_balance + r.amount
    WHERE id = r.id;

    v_running_balance := v_running_balance + r.amount;
  END LOOP;
END;
$$;
