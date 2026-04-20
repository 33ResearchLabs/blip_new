-- Migration 101: Ledger audit improvements (C2, M4, M3)
--
-- Pure audit/cleanup additions. Does NOT touch:
-- - Order state machine (no status transitions)
-- - Role resolution (no merchant_id / buyer_merchant_id / user_id changes)
-- - Balance updates (no UPDATE to merchants.balance or users.balance)
-- - Escrow lock/release/refund logic
--
-- Only:
-- 1. C2: INSERT trigger to log ESCROW_LOCK when an order is created with
--        escrow_tx_hash already set (escrow-first flow for merchant orders).
--        Current auto_log_order_ledger only fires on UPDATE.
-- 2. M4: Make auto_log_order_ledger use release_tx_hash for FEE entries
--        (better audit trail — links DB fee to on-chain treasury receipt).
-- 3. M3: cleanup_stale_sessions() function that revokes sessions not used
--        in 7 days. Callable by cron endpoint. Does not touch active sessions.

-- ════════════════════════════════════════════════════════════════════════
-- C2: INSERT trigger for ESCROW_LOCK ledger entry
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION log_escrow_lock_on_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_account_type VARCHAR(20);
  v_account_id UUID;
  v_entry_exists BOOLEAN;
BEGIN
  -- Only log if escrow is already locked at creation time
  IF NEW.escrow_tx_hash IS NULL THEN
    RETURN NEW;
  END IF;

  -- Determine who funded the escrow (same logic as auto_log_order_ledger)
  v_account_type := COALESCE(NEW.escrow_debited_entity_type, 'merchant');
  v_account_id := COALESCE(NEW.escrow_debited_entity_id, NEW.merchant_id);

  -- Safety: skip if we can't determine the payer
  IF v_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Idempotency: skip if LOCK entry already exists (defensive — shouldn't
  -- happen on INSERT but guards against manual backfills)
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
      jsonb_build_object('order_type', NEW.type, 'source', 'trigger_insert')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_log_escrow_lock_on_insert ON orders;
CREATE TRIGGER trigger_log_escrow_lock_on_insert
AFTER INSERT ON orders
FOR EACH ROW
EXECUTE FUNCTION log_escrow_lock_on_insert();

-- ════════════════════════════════════════════════════════════════════════
-- M4: Update auto_log_order_ledger to use release_tx_hash for FEE
-- ════════════════════════════════════════════════════════════════════════
-- The existing function has four blocks: ESCROW_LOCK, ESCROW_RELEASE, FEE,
-- ESCROW_REFUND. Only the FEE block uses NULL for related_tx_hash (it was
-- inside the "completed" branch but passed NULL explicitly). We change just
-- that one NULL to NEW.release_tx_hash (with fallback to escrow_tx_hash if
-- release hasn't been set yet). Rest of the function is identical.

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
    IF NEW.buyer_merchant_id IS NOT NULL THEN
      v_account_type := 'merchant';
      v_account_id := NEW.buyer_merchant_id;
    ELSIF NEW.type = 'buy' THEN
      v_account_type := 'user';
      v_account_id := NEW.user_id;
    ELSE
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
          -- M4 change: use release_tx_hash (fallback to escrow_tx_hash)
          -- so FEE entry links to the on-chain release where treasury received funds
          COALESCE(NEW.release_tx_hash, NEW.escrow_tx_hash),
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

-- ════════════════════════════════════════════════════════════════════════
-- M3: Session cleanup function
-- ════════════════════════════════════════════════════════════════════════
-- Revokes sessions that haven't been used in 7+ days. Callable via cron.
-- Does NOT delete rows — just sets is_revoked=true so audit history is kept.
CREATE OR REPLACE FUNCTION cleanup_stale_sessions()
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE sessions
  SET is_revoked = true,
      revoked_at = NOW()
  WHERE is_revoked = false
    AND last_used_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════════════
-- M1: Backfill missing ESCROW_RELEASE ledger entries for completed orders
-- ════════════════════════════════════════════════════════════════════════
-- These are historical completed orders (pre-ledger-trigger) where the FEE
-- entry exists but ESCROW_RELEASE was never logged. The completion state
-- + presence of FEE entry prove the release happened on-chain — we just
-- didn't record the recipient credit in the ledger.
--
-- Recipient determination follows CLAUDE.md role rules exactly:
--   M2M orders:  buyer_merchant_id is ALWAYS the buyer (recipient)
--   Non-M2M buy: user_id is the buyer (user bought USDT)
--   Non-M2M sell: merchant_id is the buyer (merchant bought USDT from user)
--
-- Idempotency: INSERT … ON CONFLICT DO NOTHING. The UNIQUE index
-- idx_ledger_no_duplicate_financial on (related_order_id, entry_type,
-- account_id) guarantees no duplicate if run twice.
INSERT INTO ledger_entries (
  account_type, account_id, entry_type, amount, asset,
  related_order_id, related_tx_hash, description, metadata
)
SELECT
  CASE
    WHEN o.buyer_merchant_id IS NOT NULL THEN 'merchant'
    WHEN o.type = 'buy' THEN 'user'
    ELSE 'merchant'
  END AS account_type,
  CASE
    WHEN o.buyer_merchant_id IS NOT NULL THEN o.buyer_merchant_id
    WHEN o.type = 'buy' THEN o.user_id
    ELSE o.merchant_id
  END AS account_id,
  'ESCROW_RELEASE' AS entry_type,
  o.crypto_amount AS amount,
  COALESCE(o.crypto_currency, 'USDT') AS asset,
  o.id AS related_order_id,
  o.escrow_tx_hash AS related_tx_hash,
  'Funds received from escrow for order #' || o.order_number AS description,
  jsonb_build_object(
    'order_type', o.type,
    'source', 'migration_101_m1_backfill'
  ) AS metadata
FROM orders o
WHERE o.status = 'completed'
  AND o.escrow_tx_hash IS NOT NULL
  AND o.release_tx_hash IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries le
    WHERE le.related_order_id = o.id AND le.entry_type = 'ESCROW_RELEASE'
  )
  -- Only backfill if FEE entry exists (proof completion fully processed)
  AND EXISTS (
    SELECT 1 FROM ledger_entries le
    WHERE le.related_order_id = o.id AND le.entry_type = 'FEE'
  )
  -- Guard: recipient_id must not be NULL
  AND (
    o.buyer_merchant_id IS NOT NULL
    OR (o.type = 'buy' AND o.user_id IS NOT NULL)
    OR (o.type = 'sell' AND o.merchant_id IS NOT NULL)
  )
ON CONFLICT DO NOTHING;
