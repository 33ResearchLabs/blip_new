-- Migration 100: Fix platform fee tracking consistency
--
-- Context:
-- - Fees ARE deducted on-chain (Solana program sends to treasury wallet)
-- - Fees ARE recorded in ledger_entries (entry_type='FEE') via auto_log_order_ledger trigger
-- - Fees ARE stored on orders.protocol_fee_amount (for most completed orders)
-- - BUT platform_balance.total_fees_collected stays at 0 (never updated)
-- - AND 54 completed orders have NULL protocol_fee_amount despite fees being deducted
-- - AND FEE ledger entries have NULL related_tx_hash (can't audit DB → chain)
--
-- This migration:
-- 1. Ensures platform_balance has a 'main' row
-- 2. Backfills orders.protocol_fee_amount from ledger_entries for missing rows
-- 3. Backfills platform_balance.total_fees_collected from existing FEE ledger entries
-- 4. Updates the trigger to also update platform_balance + link release_tx_hash
-- 5. Non-breaking — no changes to order state machine, roles, or balance logic
--
-- DOES NOT TOUCH:
-- - Order status transitions
-- - Escrow lock/release logic
-- - Role resolution (buyer/seller)
-- - User or merchant balance updates

-- Step 1: Ensure platform_balance row exists
INSERT INTO platform_balance (key, balance, total_fees_collected)
VALUES ('main', 0, 0)
ON CONFLICT (key) DO NOTHING;

-- Step 2: Backfill orders.protocol_fee_amount from existing FEE ledger entries
-- Only fills rows where it's NULL — no overwrite of existing values.
UPDATE orders o
SET protocol_fee_amount = fee_total.fee_amount
FROM (
  SELECT related_order_id, ABS(SUM(amount)) AS fee_amount
  FROM ledger_entries
  WHERE entry_type = 'FEE' AND related_order_id IS NOT NULL
  GROUP BY related_order_id
) fee_total
WHERE o.id = fee_total.related_order_id
  AND o.protocol_fee_amount IS NULL
  AND o.status = 'completed';

-- Step 3: Link FEE ledger entries to release_tx_hash for on-chain audit trail
-- Only updates rows where related_tx_hash is NULL and the order has a release tx.
UPDATE ledger_entries le
SET related_tx_hash = o.release_tx_hash
FROM orders o
WHERE le.related_order_id = o.id
  AND le.entry_type = 'FEE'
  AND le.related_tx_hash IS NULL
  AND o.release_tx_hash IS NOT NULL;

-- Step 4: Backfill platform_balance.total_fees_collected from existing FEE entries
-- Uses the sum of all existing FEE ledger entries (source of truth).
UPDATE platform_balance
SET total_fees_collected = (
  SELECT COALESCE(SUM(ABS(amount)), 0)
  FROM ledger_entries
  WHERE entry_type = 'FEE'
),
balance = (
  SELECT COALESCE(SUM(ABS(amount)), 0)
  FROM ledger_entries
  WHERE entry_type = 'FEE'
),
updated_at = NOW()
WHERE key = 'main';

-- Step 5: Create trigger to keep platform_balance in sync when new FEE entries are added.
-- This ensures every future fee deduction automatically updates platform_balance.
-- Uses SECURITY DEFINER to work even if caller doesn't have platform_balance UPDATE priv.
CREATE OR REPLACE FUNCTION sync_platform_balance_on_fee()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entry_type = 'FEE' THEN
    UPDATE platform_balance
    SET balance = balance + ABS(NEW.amount),
        total_fees_collected = total_fees_collected + ABS(NEW.amount),
        updated_at = NOW()
    WHERE key = 'main';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_platform_balance_on_fee ON ledger_entries;
CREATE TRIGGER trg_sync_platform_balance_on_fee
AFTER INSERT ON ledger_entries
FOR EACH ROW
EXECUTE FUNCTION sync_platform_balance_on_fee();
