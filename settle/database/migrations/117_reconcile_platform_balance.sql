-- Migration 117: Reconcile platform_balance.balance with the FEE ledger.
--
-- Symptom (admin console /admin):
--   PLATFORM BALANCE tile = 0.00, FEES tile = 2.85, REVENUE = 2.85.
--   `platform_balance.balance` and `platform_balance.total_fees_collected`
--   are read from the SAME row but show different values, which violates
--   the invariant established in migration 100 (both columns are written
--   in lockstep by sync_platform_balance_on_fee).
--
-- Root cause (one or both):
--   1. The migration 100 trigger (sync_platform_balance_on_fee) is not
--      installed on this DB — possibly the migration silently failed on
--      a prior core-api startup, or the function was dropped manually.
--      Without the trigger, FEE ledger inserts no longer increment
--      platform_balance at all, and the value drifts from the ledger.
--   2. The `balance` column was manually reset (e.g. an operator ran
--      `UPDATE platform_balance SET balance = 0`) without resetting
--      `total_fees_collected` — leaving the two columns out of sync.
--
-- Source of truth:
--   `ledger_entries` (entry_type='FEE'). Production fee writes go through
--   the auto_log_order_ledger trigger which inserts here. This is the one
--   table we trust for "how much has the platform actually earned in fees."
--   Both platform_balance columns are derivative running totals.
--
-- What this migration does:
--   1. Re-installs sync_platform_balance_on_fee as CREATE OR REPLACE +
--      DROP/CREATE TRIGGER — guarantees the invariant-keeping trigger is
--      in place going forward, regardless of prior DB state.
--   2. Ensures the 'main' platform_balance row exists.
--   3. Re-derives BOTH columns from SUM(ABS(amount)) of all FEE ledger
--      entries — the authoritative number. This corrects whichever column
--      had drifted (in this case, balance) without trusting the other
--      column as a reference.
--
-- Safety:
--   - Idempotent — every statement uses IF NOT EXISTS / CREATE OR REPLACE
--     / DROP IF EXISTS / ON CONFLICT.
--   - Does NOT modify ledger_entries, orders, or any user/merchant balance.
--   - Both columns end up equal to SUM(FEE ledger entries) — even if they
--     were already correct, this is a no-op. Even if they were both wrong
--     in the same direction, this snaps them back to the source of truth.
--   - The trigger handles all future fee writes; this migration only
--     repairs the historical state.
--
-- Rollback:
--   None needed. The trigger function is unchanged from migration 100,
--   and the data fix is converging to the authoritative ledger sum, so
--   re-running this migration is harmless.

-- Step 1: Ensure platform_balance row exists.
INSERT INTO platform_balance (key, balance, total_fees_collected)
VALUES ('main', 0, 0)
ON CONFLICT (key) DO NOTHING;

-- Step 2: Re-install sync_platform_balance_on_fee. Identical body to
-- migration 100; CREATE OR REPLACE means this is a no-op if already
-- installed correctly, and a fix if the function was dropped or never
-- ran. Both columns increment together so the invariant
-- balance == total_fees_collected always holds for new fee writes.
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

-- Step 3: Reconcile both columns from the FEE ledger. Authoritative
-- because production fee deductions all flow through ledger_entries via
-- the auto_log_order_ledger trigger (see migration 115 header — the TS
-- helpers that wrote platform_balance directly are orphaned). This
-- snaps the running totals back to ground truth in one shot.
UPDATE platform_balance
SET balance = (
      SELECT COALESCE(SUM(ABS(amount)), 0)
      FROM ledger_entries
      WHERE entry_type = 'FEE'
    ),
    total_fees_collected = (
      SELECT COALESCE(SUM(ABS(amount)), 0)
      FROM ledger_entries
      WHERE entry_type = 'FEE'
    ),
    updated_at = NOW()
WHERE key = 'main';
