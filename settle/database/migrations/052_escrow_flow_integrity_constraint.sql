-- Migration 052: Escrow Flow Integrity Constraint
--
-- Enforces at the DATABASE level that orders in payment/completion statuses
-- must have escrow_debited_entity_id populated. This is a defense-in-depth
-- measure — the application layer already validates this, but a DB constraint
-- guarantees it even if a bug bypasses the app checks.
--
-- Constraint: if status is payment_sent, payment_confirmed, releasing, or completed,
-- then escrow_debited_entity_id MUST NOT be NULL.
--
-- IMPORTANT: Historical orders created before migration 026 may have NULL
-- escrow_debited_entity_id. We backfill these FIRST using the same
-- seller-determination logic as the application code (determineEscrowPayer):
--   - M2M orders (buyer_merchant_id IS NOT NULL): merchant_id is the seller
--   - Buy orders: merchant_id is the seller (merchant has crypto to sell)
--   - Sell orders: user_id is the seller (user has crypto to sell)

-- ============================================================
-- STEP 1: Backfill missing escrow_debited_entity_id on historical orders
-- ============================================================

-- Temp table to track which rows we fix (for audit logging)
CREATE TEMP TABLE IF NOT EXISTS _mig052_fixed_ids (
  order_id UUID NOT NULL
);

DO $$
DECLARE
  v_count INT;
  v_fixed_m2m INT := 0;
  v_fixed_buy INT := 0;
  v_fixed_sell INT := 0;
  v_total_fixed INT;
  v_remaining INT;
BEGIN
  -- Count violations
  SELECT COUNT(*) INTO v_count
  FROM orders
  WHERE status IN ('payment_sent', 'payment_confirmed', 'releasing', 'completed')
    AND escrow_debited_entity_id IS NULL;

  IF v_count = 0 THEN
    RAISE NOTICE '[052] No violating rows — backfill not needed.';
  ELSE
    RAISE NOTICE '[052] Found % orders missing escrow_debited_entity_id. Backfilling...', v_count;

    -- M2M orders: seller is always merchant_id
    WITH fixed AS (
      UPDATE orders
      SET escrow_debited_entity_type = 'merchant',
          escrow_debited_entity_id   = merchant_id,
          escrow_debited_amount      = COALESCE(escrow_debited_amount, crypto_amount),
          escrow_debited_at          = COALESCE(escrow_debited_at, escrowed_at, accepted_at, created_at)
      WHERE status IN ('payment_sent', 'payment_confirmed', 'releasing', 'completed')
        AND escrow_debited_entity_id IS NULL
        AND buyer_merchant_id IS NOT NULL
      RETURNING id
    )
    INSERT INTO _mig052_fixed_ids SELECT id FROM fixed;
    GET DIAGNOSTICS v_fixed_m2m = ROW_COUNT;

    -- Buy orders: merchant is the seller
    WITH fixed AS (
      UPDATE orders
      SET escrow_debited_entity_type = 'merchant',
          escrow_debited_entity_id   = merchant_id,
          escrow_debited_amount      = COALESCE(escrow_debited_amount, crypto_amount),
          escrow_debited_at          = COALESCE(escrow_debited_at, escrowed_at, accepted_at, created_at)
      WHERE status IN ('payment_sent', 'payment_confirmed', 'releasing', 'completed')
        AND escrow_debited_entity_id IS NULL
        AND buyer_merchant_id IS NULL
        AND type = 'buy'
      RETURNING id
    )
    INSERT INTO _mig052_fixed_ids SELECT id FROM fixed;
    GET DIAGNOSTICS v_fixed_buy = ROW_COUNT;

    -- Sell orders: user is the seller
    WITH fixed AS (
      UPDATE orders
      SET escrow_debited_entity_type = 'user',
          escrow_debited_entity_id   = user_id,
          escrow_debited_amount      = COALESCE(escrow_debited_amount, crypto_amount),
          escrow_debited_at          = COALESCE(escrow_debited_at, escrowed_at, accepted_at, created_at)
      WHERE status IN ('payment_sent', 'payment_confirmed', 'releasing', 'completed')
        AND escrow_debited_entity_id IS NULL
        AND buyer_merchant_id IS NULL
        AND type = 'sell'
      RETURNING id
    )
    INSERT INTO _mig052_fixed_ids SELECT id FROM fixed;
    GET DIAGNOSTICS v_fixed_sell = ROW_COUNT;

    v_total_fixed := v_fixed_m2m + v_fixed_buy + v_fixed_sell;
    RAISE NOTICE '[052] Backfilled % total: % M2M, % buy, % sell',
      v_total_fixed, v_fixed_m2m, v_fixed_buy, v_fixed_sell;
  END IF;

  -- ============================================================
  -- STEP 2: Verify zero violations remain
  -- ============================================================
  SELECT COUNT(*) INTO v_remaining
  FROM orders
  WHERE status IN ('payment_sent', 'payment_confirmed', 'releasing', 'completed')
    AND escrow_debited_entity_id IS NULL;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION '[052] FATAL: % rows still violate after backfill — manual fix required.', v_remaining;
  END IF;

  RAISE NOTICE '[052] Verification passed: 0 violating rows.';

  -- ============================================================
  -- STEP 3: Audit log (best-effort — table may not exist yet)
  -- ============================================================
  SELECT COUNT(*) INTO v_total_fixed FROM _mig052_fixed_ids;
  IF v_total_fixed > 0 THEN
    BEGIN
      INSERT INTO financial_audit_log
        (order_id, actor_type, actor_id, action, previous_status, new_status, metadata)
      SELECT
        o.id,
        'system',
        '00000000-0000-0000-0000-000000000000',
        'migration_052_backfill',
        o.status::TEXT,
        o.status::TEXT,
        jsonb_build_object(
          'migration',              '052_escrow_flow_integrity_constraint',
          'reason',                 'Historical order missing escrow_debited_entity_id',
          'backfilled_entity_type', o.escrow_debited_entity_type,
          'backfilled_entity_id',   o.escrow_debited_entity_id,
          'backfilled_amount',      o.escrow_debited_amount,
          'order_type',             o.type,
          'is_m2m',                 o.buyer_merchant_id IS NOT NULL
        )
      FROM orders o
      INNER JOIN _mig052_fixed_ids f ON f.order_id = o.id;

      RAISE NOTICE '[052] Logged % rows to financial_audit_log.', v_total_fixed;
    EXCEPTION
      WHEN undefined_table THEN
        RAISE NOTICE '[052] financial_audit_log not yet created — audit log skipped.';
    END;
  END IF;
END $$;

DROP TABLE IF EXISTS _mig052_fixed_ids;

-- ============================================================
-- STEP 4: Now apply the constraint (data is clean)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_escrow_required_for_payment_statuses'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT chk_escrow_required_for_payment_statuses
      CHECK (
        status NOT IN ('payment_sent', 'payment_confirmed', 'releasing', 'completed')
        OR escrow_debited_entity_id IS NOT NULL
      );
    RAISE NOTICE '[052] Constraint chk_escrow_required_for_payment_statuses applied.';
  ELSE
    RAISE NOTICE '[052] Constraint already exists — skipping.';
  END IF;
END $$;

-- Monitoring index: find any rows that somehow bypass the constraint
CREATE INDEX IF NOT EXISTS idx_orders_missing_escrow_in_payment
  ON orders (id, status)
  WHERE status IN ('payment_sent', 'payment_confirmed', 'releasing', 'completed')
    AND escrow_debited_entity_id IS NULL;
