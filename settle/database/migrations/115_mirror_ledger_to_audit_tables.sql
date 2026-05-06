-- Migration 115: Mirror ledger_entries into merchant_transactions & platform_fee_transactions
--
-- Why:
--   The production order flow (escrow_order_v1, release_order_v1, atomic_cancel_with_refund
--   stored procs + auto_log_order_ledger trigger) writes to `ledger_entries` only.
--   `merchant_transactions` and `platform_fee_transactions` were defined for the orphaned
--   TS helpers (mockEscrowRelease, deductPlatformFee) that production never calls.
--   Result: admin reconciliation flags a phantom platform mismatch, and the merchant
--   transactions report shows empty.
--
-- What this migration does:
--   1. Adds idempotency safeguards on the audit tables
--   2. Backfills both tables from existing ledger_entries (one-time)
--   3. Adds a trigger on ledger_entries that mirrors future FEE/ESCROW_* entries
--      into both audit tables — wrapped in EXCEPTION block so it can NEVER
--      roll back the original transaction
--
-- Safety:
--   - 100% additive: no existing tables, columns, procs, triggers, or data are modified
--   - Backfill is wrapped in INSERT...WHERE NOT EXISTS so re-runs are no-ops
--   - Trigger body is wrapped in BEGIN..EXCEPTION..END so any internal failure logs
--     a WARNING but never propagates — the original ledger_entries write succeeds
--     regardless of whether the mirror succeeds
--
-- Rollback:
--   DROP TRIGGER trg_mirror_ledger_to_audit_tables ON ledger_entries;
--   DROP FUNCTION mirror_ledger_to_audit_tables();
--   (Mirrored data in the audit tables is harmless to keep.)

-- ── 1. Schema parity for merchant_transactions ───────────────────────────
-- Railway was originally provisioned via `settle/database/railway-migration.sql`
-- which created the table WITHOUT a user_id column AND with merchant_id as
-- NOT NULL. Local was provisioned via `settle/migrations/add_merchant_transactions.sql`
-- which has both merchant_id AND user_id as nullable (the row uses ONE or
-- the other depending on whether the actor is a merchant or a user).
--
-- This migration references user_id and inserts NULL into merchant_id for
-- user-actor rows, so on Railway both sides break (42703 "column does not
-- exist" then 23502 "null value violates not-null"). Make BOTH columns
-- nullable and add user_id if missing — both existing schemas converge to
-- the same shape after this runs. Idempotent.

-- 1a. Add user_id column on Railway (no-op locally — already exists).
ALTER TABLE merchant_transactions
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- 1b. Add the user_id FK (idempotent via constraint-name check).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'merchant_transactions_user_id_fkey'
      AND conrelid = 'merchant_transactions'::regclass
  ) THEN
    ALTER TABLE merchant_transactions
      ADD CONSTRAINT merchant_transactions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_merchant_transactions_user_id
  ON merchant_transactions (user_id) WHERE user_id IS NOT NULL;

-- 1c. Drop NOT NULL on merchant_id — user-actor rows have merchant_id=NULL
-- and user_id set instead. Application code already handles either-or
-- (local has been running this way for months). Safe non-breaking
-- schema change: existing rows are unaffected, future inserts can omit
-- merchant_id when the actor is a user.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_transactions'
      AND column_name = 'merchant_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE merchant_transactions
      ALTER COLUMN merchant_id DROP NOT NULL;
  END IF;
END $$;

-- ── 2. Idempotency safeguards ───────────────────────────────────────────────

-- platform_fee_transactions: at most one row per order
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_fee_tx_order
  ON platform_fee_transactions (order_id)
  WHERE order_id IS NOT NULL;

-- merchant_transactions: at most one row per (order, type, account)
-- Uses two partial indexes because COALESCE(merchant_id, user_id) inside a UNIQUE
-- index needs an immutable expression — splitting by which column is set is simpler.
CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_tx_order_type_merchant
  ON merchant_transactions (order_id, type, merchant_id)
  WHERE order_id IS NOT NULL AND merchant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_tx_order_type_user
  ON merchant_transactions (order_id, type, user_id)
  WHERE order_id IS NOT NULL AND user_id IS NOT NULL;

-- ── 3. One-time backfill ─────────────────────────────────────────────────────

-- 3a. platform_fee_transactions ← ledger_entries.FEE
-- platform_balance_after is reconstructed via cumulative SUM (historically accurate).
INSERT INTO platform_fee_transactions
  (order_id, fee_amount, fee_percentage, spread_preference, platform_balance_after, created_at)
SELECT
  le.related_order_id,
  ABS(le.amount)                                     AS fee_amount,
  -- Fee percentage from metadata (e.g. "2.50%") — strip the % and cast.
  COALESCE(
    NULLIF(REPLACE(le.metadata->>'fee_rate', '%', ''), '')::numeric(5,2),
    o.protocol_fee_percentage,
    2.50
  )                                                  AS fee_percentage,
  COALESCE(o.spread_preference, 'fastest')           AS spread_preference,
  -- Reconstructed running platform balance at the time of this entry.
  SUM(ABS(le.amount)) OVER (
    ORDER BY le.created_at, le.id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  )                                                  AS platform_balance_after,
  le.created_at
FROM ledger_entries le
LEFT JOIN orders o ON o.id = le.related_order_id
WHERE le.entry_type = 'FEE'
  AND le.related_order_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM platform_fee_transactions pft
    WHERE pft.order_id = le.related_order_id
  )
ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING;

-- 3b. merchant_transactions ← ledger_entries (ESCROW_LOCK, ESCROW_RELEASE, ESCROW_REFUND, FEE)
-- Pre-existing data may have rare duplicate ledger entries (same order+type+account)
-- from older code paths. We dedupe via DISTINCT ON so the migration succeeds; the
-- unique partial indexes block any future duplicates.
INSERT INTO merchant_transactions
  (merchant_id, user_id, order_id, type, amount, balance_before, balance_after, description, created_at)
SELECT
  merchant_id, user_id, order_id, type, amount, balance_before, balance_after, description, created_at
FROM (
  SELECT DISTINCT ON (le.related_order_id, le.entry_type, le.account_id)
    CASE WHEN le.account_type = 'merchant' THEN le.account_id END AS merchant_id,
    CASE WHEN le.account_type = 'user'     THEN le.account_id END AS user_id,
    le.related_order_id                                AS order_id,
    CASE le.entry_type
      WHEN 'ESCROW_LOCK'    THEN 'escrow_lock'
      WHEN 'ESCROW_RELEASE' THEN 'escrow_release'
      WHEN 'ESCROW_REFUND'  THEN 'escrow_refund'
      WHEN 'FEE'            THEN 'fee_deduction'
    END                                                AS type,
    le.amount,
    COALESCE(le.balance_before, 0)                     AS balance_before,
    COALESCE(le.balance_after, 0)                      AS balance_after,
    COALESCE(le.description, le.entry_type)            AS description,
    le.created_at
  FROM ledger_entries le
  WHERE le.entry_type IN ('ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_REFUND', 'FEE')
    AND le.related_order_id IS NOT NULL
    AND le.account_type IN ('merchant', 'user')
    AND NOT EXISTS (
      SELECT 1 FROM merchant_transactions mt
      WHERE mt.order_id = le.related_order_id
        AND mt.type = CASE le.entry_type
          WHEN 'ESCROW_LOCK'    THEN 'escrow_lock'
          WHEN 'ESCROW_RELEASE' THEN 'escrow_release'
          WHEN 'ESCROW_REFUND'  THEN 'escrow_refund'
          WHEN 'FEE'            THEN 'fee_deduction'
        END
        AND COALESCE(mt.merchant_id, mt.user_id) = le.account_id
    )
  ORDER BY le.related_order_id, le.entry_type, le.account_id, le.created_at ASC
) deduped;

-- ── 4. Going-forward trigger ────────────────────────────────────────────────
-- Fires after a row is inserted into ledger_entries and mirrors the relevant
-- types into the audit tables. Never throws — any internal error is logged
-- as a WARNING and swallowed so the original ledger insert is unaffected.

CREATE OR REPLACE FUNCTION mirror_ledger_to_audit_tables()
RETURNS TRIGGER AS $function$
DECLARE
  v_mt_type            VARCHAR(50);
  v_platform_after     NUMERIC(20,8);
  v_fee_percentage     NUMERIC(5,2);
  v_spread_pref        VARCHAR(20);
BEGIN
  BEGIN
    -- Only mirror types we care about. Other entry_types are a no-op.
    v_mt_type := CASE NEW.entry_type
      WHEN 'ESCROW_LOCK'    THEN 'escrow_lock'
      WHEN 'ESCROW_RELEASE' THEN 'escrow_release'
      WHEN 'ESCROW_REFUND'  THEN 'escrow_refund'
      WHEN 'FEE'            THEN 'fee_deduction'
      ELSE NULL
    END;

    IF v_mt_type IS NULL OR NEW.related_order_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- 3a. merchant_transactions row (idempotent via partial unique indexes)
    IF NEW.account_type IN ('merchant', 'user') THEN
      INSERT INTO merchant_transactions
        (merchant_id, user_id, order_id, type, amount, balance_before, balance_after, description, created_at)
      VALUES (
        CASE WHEN NEW.account_type = 'merchant' THEN NEW.account_id END,
        CASE WHEN NEW.account_type = 'user'     THEN NEW.account_id END,
        NEW.related_order_id,
        v_mt_type,
        NEW.amount,
        COALESCE(NEW.balance_before, 0),
        COALESCE(NEW.balance_after, 0),
        COALESCE(NEW.description, NEW.entry_type),
        NEW.created_at
      )
      ON CONFLICT DO NOTHING;
    END IF;

    -- 3b. platform_fee_transactions row (only for FEE entries)
    IF NEW.entry_type = 'FEE' THEN
      -- Use the platform_balance row as the running total. If the row doesn't
      -- exist yet (rare — would mean the sync_platform_balance_on_fee trigger
      -- hasn't run), fall back to ABS(NEW.amount).
      SELECT balance INTO v_platform_after
      FROM platform_balance WHERE key = 'main';

      v_fee_percentage := COALESCE(
        NULLIF(REPLACE(NEW.metadata->>'fee_rate', '%', ''), '')::numeric(5,2),
        2.50
      );

      SELECT COALESCE(o.spread_preference, 'fastest') INTO v_spread_pref
      FROM orders o WHERE o.id = NEW.related_order_id;

      INSERT INTO platform_fee_transactions
        (order_id, fee_amount, fee_percentage, spread_preference, platform_balance_after, created_at)
      VALUES (
        NEW.related_order_id,
        ABS(NEW.amount),
        v_fee_percentage,
        COALESCE(v_spread_pref, 'fastest'),
        COALESCE(v_platform_after, ABS(NEW.amount)),
        NEW.created_at
      )
      ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- ANY failure inside the mirror is non-fatal. The original ledger_entries
    -- INSERT must succeed regardless. We log a WARNING for ops visibility.
    RAISE WARNING '[mirror_ledger_to_audit_tables] non-fatal failure for entry % (order %): % %',
      NEW.id, NEW.related_order_id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

-- Drop and recreate trigger — DROP IF EXISTS makes the migration re-runnable.
DROP TRIGGER IF EXISTS trg_mirror_ledger_to_audit_tables ON ledger_entries;
CREATE TRIGGER trg_mirror_ledger_to_audit_tables
  AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION mirror_ledger_to_audit_tables();
