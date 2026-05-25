-- ============================================================================
-- 142_dedupe_manual_credit_and_extend_idempotent_index.sql
--
-- Fixes the duplicate-welcome-bonus accumulation in blip_point_log.
--
-- Background
-- ----------
-- bootstrapNewActor() (settle/src/lib/coins/onboarding.ts) is called from the
-- user + merchant auth routes on every login, not just first signup. It writes
-- a MANUAL_CREDIT row with source_ref='signup_starter' and ON CONFLICT DO
-- NOTHING, relying on the partial unique index
--   idx_blip_point_log_idempotent_source (actor_type, actor_id, event, source_ref)
-- to dedupe.
--
-- Migration 132 created that index without MANUAL_CREDIT in the event list,
-- so the bootstrap insert never conflicted. Migration 134 tried to extend
-- the index to include MANUAL_CREDIT, but once even one duplicate row exists
-- in the table, CREATE UNIQUE INDEX fails, the whole migration rolls back,
-- and the old (insufficient) index is preserved. The race is unrecoverable
-- without an explicit dedupe pass — which is what this migration does.
--
-- Observed in production: a single merchant accumulated 11
-- (MANUAL_CREDIT, 'signup_starter') rows from 11 logins. blip_points balance
-- was unaffected because bootstrap uses GREATEST(blip_points, 100), but the
-- ledger was no longer a faithful audit trail.
--
-- Strategy
-- --------
-- 1. Dedupe existing rows: for each (actor_type, actor_id, event, source_ref)
--    where event IN (MANUAL_CREDIT, MANUAL_DEBIT) AND source_ref IS NOT NULL,
--    keep the earliest row and delete the rest. Earliest = the legitimate
--    first grant; the later rows are the duplicates the bug created.
--
-- 2. Drop and recreate the partial unique index to include MANUAL_CREDIT,
--    MANUAL_DEBIT, and the other event types migration 134 had intended.
--    With the duplicates gone, the unique constraint now succeeds.
--
-- Safety
-- ------
-- - The dedupe DELETE is bounded by the (event IN ..., source_ref NOT NULL)
--   filter — it cannot touch waitlist REGISTER / MERCHANT_REGISTER rows
--   (those have source_ref = NULL and are guarded by
--   idx_blip_point_log_register_once), nor any trade-driven event.
-- - We do NOT adjust merchants.blip_points or users.blip_points. Bootstrap's
--   GREATEST() balance write was already idempotent for the user-visible
--   balance; the divergence was confined to the ledger.
-- - Idempotent: re-running this migration after it has applied is a no-op
--   (DELETE finds nothing, index is recreated identically).
-- - LOCK TABLE blocks concurrent writes for the duration of this migration.
--   Required because the migration runner swallows pgcode 23505
--   (unique_violation) and marks the migration applied — if a concurrent
--   login slipped a duplicate in between DELETE and CREATE UNIQUE INDEX,
--   the index creation would fail with 23505 and we'd be stuck with the
--   bug + a "migration applied" tombstone. The lock window is short
--   (DELETE on a small slice of the table, then a DROP + CREATE INDEX).
-- - Wrapped in the migration runner's transaction, so a partial failure
--   leaves the original index in place.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Block concurrent writes to blip_point_log for the rest of the txn.
--    ACCESS EXCLUSIVE is overkill, SHARE ROW EXCLUSIVE blocks INSERTs while
--    allowing reads, which is the minimum needed to make dedupe + reindex
--    a single atomic step.
-- ----------------------------------------------------------------------------
LOCK TABLE blip_point_log IN SHARE ROW EXCLUSIVE MODE;

-- ----------------------------------------------------------------------------
-- 1. Dedupe duplicate MANUAL_CREDIT / MANUAL_DEBIT rows. Keep the earliest
--    per (actor_type, actor_id, event, source_ref); delete the rest.
-- ----------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY actor_type, actor_id, event, source_ref
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM blip_point_log
  WHERE event IN ('MANUAL_CREDIT', 'MANUAL_DEBIT')
    AND source_ref IS NOT NULL
)
DELETE FROM blip_point_log
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ----------------------------------------------------------------------------
-- 2. Recreate the partial unique index with the full event list from
--    migration 134. Using DROP + CREATE in a DO block keeps the migration
--    re-runnable across both the pre-134 and post-134 index shapes.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_blip_point_log_idempotent_source'
  ) THEN
    DROP INDEX idx_blip_point_log_idempotent_source;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_blip_point_log_idempotent_source
  ON blip_point_log (actor_type, actor_id, event, source_ref)
  WHERE source_ref IS NOT NULL
    AND event IN (
      'FIRST_TRADE',
      'TRADE_COMPLETED',
      'VOLUME_BONUS',
      'FIVE_STAR_RECEIVED',
      'DISPUTE_FREE_MONTH',
      'REFERRAL_TRADE_CREDITED',
      'KYC_COMPLETED',
      'MANUAL_CREDIT',
      'MANUAL_DEBIT',
      'LIMIT_BUMP_BURN',
      'PERK_BURN'
    );

-- ----------------------------------------------------------------------------
-- 3. Diagnostic notice — emits dedupe + index summary for the operator that
--    runs the migration. Cheap aggregates, only over MANUAL_* rows.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_manual_rows  int;
  v_distinct_keys int;
BEGIN
  SELECT COUNT(*) INTO v_manual_rows
    FROM blip_point_log
   WHERE event IN ('MANUAL_CREDIT', 'MANUAL_DEBIT')
     AND source_ref IS NOT NULL;

  SELECT COUNT(*) INTO v_distinct_keys
    FROM (
      SELECT DISTINCT actor_type, actor_id, event, source_ref
        FROM blip_point_log
       WHERE event IN ('MANUAL_CREDIT', 'MANUAL_DEBIT')
         AND source_ref IS NOT NULL
    ) t;

  RAISE NOTICE '[migration 142] MANUAL_* rows with source_ref: rows=%, distinct_keys=% (equal after dedupe)',
    v_manual_rows, v_distinct_keys;
END$$;
