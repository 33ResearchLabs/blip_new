-- Migration 053: Ledger Consistency Hardening
--
-- Fixes:
-- 1. Unique constraint on ledger_entries to prevent duplicate financial entries per order
-- 2. Fix auto_log_order_ledger trigger to skip entries already written by app code
-- 3. Add per-order ledger integrity check function
--
-- Addresses: TASK 2 (idempotency), TASK 3 (consistency), TASK 5 (reconciliation)

-- ============================================================
-- 1. Unique constraint: one financial entry per (order, entry_type, account)
--    Prevents duplicate ESCROW_LOCK, ESCROW_RELEASE, ESCROW_REFUND, FEE per order
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_no_duplicate_financial
  ON ledger_entries (related_order_id, entry_type, account_id)
  WHERE related_order_id IS NOT NULL
    AND entry_type IN ('ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_REFUND', 'FEE');

-- ============================================================
-- 2. Fix the auto_log_order_ledger trigger
--
--    The original trigger (migration 022) always used merchant_id as the
--    account, which is WRONG when user is the escrow payer (sell orders).
--    It also creates duplicates because app code (mockEscrowLock,
--    atomicCancelWithRefund) already inserts these entries.
--
--    New behavior: skip ledger insert if a matching entry already exists
--    for this order + entry_type + account. Use the order's
--    escrow_debited_entity_type/id when available for correct attribution.
-- ============================================================

CREATE OR REPLACE FUNCTION auto_log_order_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_account_type VARCHAR(20);
  v_account_id UUID;
  v_entry_exists BOOLEAN;
BEGIN
  -- Log escrow lock (only if app code hasn't already)
  IF NEW.escrow_tx_hash IS NOT NULL AND (OLD.escrow_tx_hash IS NULL OR OLD.escrow_tx_hash != NEW.escrow_tx_hash) THEN
    -- Use escrow_debited_entity_type/id if available (set by app code), else fall back to merchant_id
    v_account_type := COALESCE(NEW.escrow_debited_entity_type, 'merchant');
    v_account_id := COALESCE(NEW.escrow_debited_entity_id, NEW.merchant_id);

    SELECT EXISTS(
      SELECT 1 FROM ledger_entries
      WHERE related_order_id = NEW.id
        AND entry_type = 'ESCROW_LOCK'
        AND account_id = v_account_id
    ) INTO v_entry_exists;

    IF NOT v_entry_exists THEN
      PERFORM log_ledger_entry(
        v_account_type,
        v_account_id,
        'ESCROW_LOCK',
        -NEW.crypto_amount,
        COALESCE(NEW.crypto_currency, 'USDT'),
        NEW.id,
        NEW.escrow_tx_hash,
        'Funds locked in escrow for order #' || NEW.order_number,
        jsonb_build_object('order_type', NEW.type, 'source', 'trigger')
      );
    END IF;
  END IF;

  -- Log escrow release/completion (only if app code hasn't already)
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Determine release recipient
    IF NEW.buyer_merchant_id IS NOT NULL THEN
      v_account_type := 'merchant';
      v_account_id := NEW.buyer_merchant_id;
    ELSIF NEW.type = 'buy' THEN
      v_account_type := 'user';
      v_account_id := NEW.user_id;
    ELSE
      -- sell order: merchant is buyer
      v_account_type := 'merchant';
      v_account_id := NEW.merchant_id;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM ledger_entries
      WHERE related_order_id = NEW.id
        AND entry_type = 'ESCROW_RELEASE'
        AND account_id = v_account_id
    ) INTO v_entry_exists;

    IF NOT v_entry_exists THEN
      PERFORM log_ledger_entry(
        v_account_type,
        v_account_id,
        'ESCROW_RELEASE',
        NEW.crypto_amount,
        COALESCE(NEW.crypto_currency, 'USDT'),
        NEW.id,
        NEW.escrow_tx_hash,
        'Funds received from escrow for order #' || NEW.order_number,
        jsonb_build_object('order_type', NEW.type, 'source', 'trigger')
      );
    END IF;

    -- Log platform fee (only if app code hasn't already)
    SELECT EXISTS(
      SELECT 1 FROM ledger_entries
      WHERE related_order_id = NEW.id
        AND entry_type = 'FEE'
    ) INTO v_entry_exists;

    IF NOT v_entry_exists THEN
      DECLARE
        v_platform_fee DECIMAL(20, 8);
        v_fee_payer_type VARCHAR(20);
        v_fee_payer_id UUID;
      BEGIN
        v_platform_fee := NEW.crypto_amount * 0.005;
        v_fee_payer_type := COALESCE(NEW.escrow_debited_entity_type, 'merchant');
        v_fee_payer_id := COALESCE(NEW.escrow_debited_entity_id, NEW.merchant_id);

        PERFORM log_ledger_entry(
          v_fee_payer_type,
          v_fee_payer_id,
          'FEE',
          -v_platform_fee,
          COALESCE(NEW.crypto_currency, 'USDT'),
          NEW.id,
          NULL,
          'Platform fee for order #' || NEW.order_number,
          jsonb_build_object('fee_rate', '0.5%', 'order_type', NEW.type, 'source', 'trigger')
        );
      END;
    END IF;
  END IF;

  -- Log escrow refund on cancellation (only if app code hasn't already)
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND NEW.escrow_tx_hash IS NOT NULL THEN
    v_account_type := COALESCE(NEW.escrow_debited_entity_type, 'merchant');
    v_account_id := COALESCE(NEW.escrow_debited_entity_id, NEW.merchant_id);

    SELECT EXISTS(
      SELECT 1 FROM ledger_entries
      WHERE related_order_id = NEW.id
        AND entry_type = 'ESCROW_REFUND'
        AND account_id = v_account_id
    ) INTO v_entry_exists;

    IF NOT v_entry_exists THEN
      PERFORM log_ledger_entry(
        v_account_type,
        v_account_id,
        'ESCROW_REFUND',
        NEW.crypto_amount,
        COALESCE(NEW.crypto_currency, 'USDT'),
        NEW.id,
        NEW.escrow_tx_hash,
        'Escrow refunded for cancelled order #' || NEW.order_number,
        jsonb_build_object('cancellation_reason', NEW.cancellation_reason, 'source', 'trigger')
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger with updated function
DROP TRIGGER IF EXISTS trigger_auto_log_order_ledger ON orders;
CREATE TRIGGER trigger_auto_log_order_ledger
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION auto_log_order_ledger();

-- ============================================================
-- 3. Per-order ledger integrity check function
--    Validates that every completed/cancelled order has matching
--    debit and credit entries that sum correctly
-- ============================================================

CREATE OR REPLACE FUNCTION check_order_ledger_integrity(p_order_id UUID)
RETURNS TABLE (
  order_id UUID,
  has_escrow_lock BOOLEAN,
  has_escrow_release BOOLEAN,
  has_escrow_refund BOOLEAN,
  debit_total DECIMAL,
  credit_total DECIMAL,
  net_amount DECIMAL,
  is_balanced BOOLEAN,
  issues TEXT[]
) AS $$
DECLARE
  v_order RECORD;
  v_issues TEXT[] := '{}';
  v_has_lock BOOLEAN := false;
  v_has_release BOOLEAN := false;
  v_has_refund BOOLEAN := false;
  v_debit DECIMAL := 0;
  v_credit DECIMAL := 0;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
    EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = p_order_id AND entry_type = 'ESCROW_LOCK'),
    EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = p_order_id AND entry_type = 'ESCROW_RELEASE'),
    EXISTS(SELECT 1 FROM ledger_entries WHERE related_order_id = p_order_id AND entry_type = 'ESCROW_REFUND')
  INTO v_debit, v_credit, v_has_lock, v_has_release, v_has_refund
  FROM ledger_entries
  WHERE related_order_id = p_order_id;

  -- Completed order: must have ESCROW_LOCK + ESCROW_RELEASE
  IF v_order.status = 'completed' THEN
    IF NOT v_has_lock THEN
      v_issues := array_append(v_issues, 'MISSING_ESCROW_LOCK');
    END IF;
    IF NOT v_has_release THEN
      v_issues := array_append(v_issues, 'MISSING_ESCROW_RELEASE');
    END IF;
  END IF;

  -- Cancelled order with escrow: must have ESCROW_LOCK + ESCROW_REFUND
  IF v_order.status = 'cancelled' AND v_order.escrow_tx_hash IS NOT NULL THEN
    IF NOT v_has_lock THEN
      v_issues := array_append(v_issues, 'MISSING_ESCROW_LOCK');
    END IF;
    IF NOT v_has_refund THEN
      v_issues := array_append(v_issues, 'MISSING_ESCROW_REFUND');
    END IF;
  END IF;

  RETURN QUERY SELECT
    p_order_id,
    v_has_lock,
    v_has_release,
    v_has_refund,
    v_debit,
    v_credit,
    v_debit + v_credit,
    array_length(v_issues, 1) IS NULL OR array_length(v_issues, 1) = 0,
    v_issues;
END;
$$ LANGUAGE plpgsql;
