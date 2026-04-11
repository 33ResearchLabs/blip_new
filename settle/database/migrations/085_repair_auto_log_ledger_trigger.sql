-- Migration 085: Repair auto_log_order_ledger trigger
--
-- The trigger function in production is the OLD version from migration 022.
-- Migration 053 was supposed to update it (alongside creating the partial
-- unique index idx_ledger_no_duplicate_financial), but the function update
-- never landed — only the index creation eventually did (see migration 084).
--
-- Symptom: payment-deadline-worker's atomicCancelWithRefund fails on every
-- escrowed-order refund attempt with PostgreSQL error 23505:
--
--   "duplicate key value violates unique constraint
--    'idx_ledger_no_duplicate_financial'"
--
-- Root cause flow:
--   1. atomicCancel inserts an ESCROW_REFUND ledger entry (with ON CONFLICT
--      DO NOTHING on the partial unique index — works correctly).
--   2. atomicCancel UPDATEs orders SET status = 'cancelled' which fires the
--      AFTER UPDATE trigger.
--   3. The OLD trigger function inserts ANOTHER ESCROW_REFUND row via
--      log_ledger_entry() without first checking for duplicates.
--   4. log_ledger_entry's INSERT only handles ON CONFLICT (idempotency_key);
--      the partial unique index is not matched, so the duplicate row violates
--      the constraint and the whole transaction rolls back.
--
-- Fix: replace the trigger function with the migration 053 version, which
-- adds SELECT EXISTS guards before each log_ledger_entry() call so the
-- trigger silently skips when the app code has already inserted the row.
--
-- The CREATE OR REPLACE means re-running this migration is idempotent.

CREATE OR REPLACE FUNCTION auto_log_order_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_account_type VARCHAR(20);
  v_account_id UUID;
  v_entry_exists BOOLEAN;
BEGIN
  -- Log escrow lock (only if app code hasn't already)
  IF NEW.escrow_tx_hash IS NOT NULL AND (OLD.escrow_tx_hash IS NULL OR OLD.escrow_tx_hash != NEW.escrow_tx_hash) THEN
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
        v_fee_rate DECIMAL(5,4);
      BEGIN
        v_fee_rate := COALESCE(NEW.protocol_fee_percentage, 2.50) / 100.0;
        v_platform_fee := NEW.crypto_amount * v_fee_rate;
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
          jsonb_build_object(
            'fee_rate', (COALESCE(NEW.protocol_fee_percentage, 2.50) || '%'),
            'order_type', NEW.type,
            'source', 'trigger'
          )
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

-- Recreate trigger to bind to the updated function (idempotent)
DROP TRIGGER IF EXISTS trigger_auto_log_order_ledger ON orders;
CREATE TRIGGER trigger_auto_log_order_ledger
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION auto_log_order_ledger();
