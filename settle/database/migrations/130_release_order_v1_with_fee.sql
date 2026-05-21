-- 130_release_order_v1_with_fee.sql
--
-- Extend release_order_v1 to also record protocol fees atomically with the
-- status flip, restoring DB-side fee accounting that was silently dropped
-- when settle's mockEscrowRelease.ts path was retired in favour of this
-- stored proc. See the treasury reconciliation work of 2026-05-21.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds a UNIQUE constraint on platform_fee_transactions(order_id) so
--      re-running release for the same order can never double-write a fee
--      (idempotency guard). Verified no dupes exist before adding.
--   2. Drops + recreates release_order_v1 with a new optional `p_fee_bps`
--      parameter (defaults to 200 = 2.00%, matches FEE_BPS_DEFAULT on
--      mainnet). The proc now:
--        - Computes the protocol fee from v_order.crypto_amount × p_fee_bps.
--        - Writes orders.protocol_fee_amount + protocol_fee_percentage on
--          completion (closes the Bug 2 NULL-fee column gap).
--        - INSERTs a platform_fee_transactions row (audit + dashboard input).
--        - UPSERTs platform_balance (dashboard headline number).
--        - DOES NOT touch users.balance / merchants.balance — chain orders
--          already debited the seller on-chain at lock time, and this is
--          the deliberate zero-regression choice (no double-debit risk).
--
-- WHY IDEMPOTENT
--   - The UNIQUE(order_id) on platform_fee_transactions makes the INSERT a
--     no-op on re-run (ON CONFLICT DO NOTHING).
--   - The platform_balance UPSERT only runs inside the same IF NOT EXISTS
--     guard, so it can't double-increment.
--   - The orders.* UPDATE is idempotent in value (same fee_bps × same
--     crypto_amount → same result every time).
--   - FOR UPDATE on the order row serializes concurrent calls.
--
-- ZERO-REGRESSION CONTRACT
--   - Signature change is additive (one new optional param). Existing
--     callers passing 3 args get p_fee_bps=200 by default.
--   - Return shape unchanged (`{ success, old_status, order }`).
--   - Existing balance-credit branch in mock mode preserved verbatim.
--   - No app balance debit added — chain still owns the seller-fee debit.

-- ─── Step 1: Idempotency guard on platform_fee_transactions ──────────────
-- Verified pre-migration that pft_distinct_orders == pft_total_rows, so this
-- constraint can be added safely without rejecting existing data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_fee_transactions_order_id_unique'
  ) THEN
    ALTER TABLE platform_fee_transactions
      ADD CONSTRAINT platform_fee_transactions_order_id_unique UNIQUE (order_id);
  END IF;
END$$;

-- ─── Step 2: Drop the old signature so the new one can be installed ──────
-- DROP IF EXISTS keeps this migration re-runnable on a fresh DB or after a
-- previous failed run.
DROP FUNCTION IF EXISTS public.release_order_v1(uuid, character varying, boolean);

-- ─── Step 3: Recreate with fee-recording behaviour ───────────────────────
CREATE OR REPLACE FUNCTION public.release_order_v1(
  p_order_id   uuid,
  p_tx_hash    character varying,
  p_mock_mode  boolean DEFAULT false,
  p_fee_bps    integer DEFAULT 200
)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_order              RECORD;
  v_old_status         VARCHAR;
  v_updated            RECORD;
  v_amount             DECIMAL;
  v_is_buy             BOOLEAN;
  v_recipient_id       UUID;
  v_recipient_table    VARCHAR;
  v_fee_amount         NUMERIC;
  v_fee_pct            NUMERIC;
  v_platform_balance   NUMERIC;
BEGIN
  -- Take the lock first so concurrent releases serialize.
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;

  -- Compute the fee from the on-chain-aligned rate. Clamp to non-negative
  -- so a bogus p_fee_bps can never produce a credit.
  v_fee_pct    := GREATEST(p_fee_bps, 0)::NUMERIC / 100.0;
  v_fee_amount := COALESCE(v_order.crypto_amount, 0) * GREATEST(p_fee_bps, 0)::NUMERIC / 10000.0;

  -- ── Status flip + per-order fee column writes (atomic with the lock) ──
  -- COALESCE pattern preserves whatever the order already had if the proc
  -- is somehow called with p_fee_bps=NULL (defensive — the DEFAULT 200
  -- means callers can't reach this branch via the documented path, but
  -- guards against fat-finger SQL).
  UPDATE orders SET
    status                  = 'completed'::order_status,
    release_tx_hash         = p_tx_hash,
    completed_at            = NOW(),
    payment_confirmed_at    = COALESCE(payment_confirmed_at, NOW()),
    order_version           = order_version + 1,
    protocol_fee_amount     = COALESCE(v_fee_amount, protocol_fee_amount),
    protocol_fee_percentage = COALESCE(v_fee_pct, protocol_fee_percentage),
    platform_fee            = COALESCE(v_fee_amount, platform_fee)
  WHERE id = p_order_id
  RETURNING * INTO v_updated;

  -- ── Mock-mode balance credit (PRESERVED VERBATIM from prior version) ──
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
      UPDATE users    SET balance = balance + v_amount WHERE id = v_recipient_id;
    END IF;
  END IF;

  -- ── Fee accounting (NEW, idempotent) ─────────────────────────────────
  -- Only do fee bookkeeping when the fee is > 0 AND we haven't already
  -- booked one for this order (PFT.unique(order_id) belt-and-braces with
  -- the IF NOT EXISTS check). Both guards survive a retry; either alone
  -- would suffice but two-layer defence is cheap.
  IF v_fee_amount > 0
     AND NOT EXISTS (SELECT 1 FROM platform_fee_transactions WHERE order_id = p_order_id) THEN

    -- Increment platform_balance and capture post-increment value for PFT.
    INSERT INTO platform_balance (key, balance, total_fees_collected, updated_at)
    VALUES ('main', v_fee_amount, v_fee_amount, NOW())
    ON CONFLICT (key) DO UPDATE SET
      balance              = platform_balance.balance + EXCLUDED.balance,
      total_fees_collected = platform_balance.total_fees_collected + EXCLUDED.total_fees_collected,
      updated_at           = NOW()
    RETURNING balance INTO v_platform_balance;

    -- Audit row. ON CONFLICT DO NOTHING is redundant with the IF NOT EXISTS
    -- above but keeps the SQL self-defensive if the guard ever moves.
    INSERT INTO platform_fee_transactions (
      order_id, fee_amount, fee_percentage, spread_preference, platform_balance_after
    ) VALUES (
      p_order_id,
      v_fee_amount,
      v_fee_pct,
      COALESCE(v_order.spread_preference, 'best'),
      v_platform_balance
    )
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success',     true,
    'old_status',  v_old_status,
    'order',       row_to_json(v_updated)
  );
END;
$function$;
