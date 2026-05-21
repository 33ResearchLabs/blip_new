-- ============================================================================
-- 134_backfill_starter_coins_and_scale_indexes.sql
--
-- Two purposes:
--   1. Backfill starter coins (100) on EVERY existing user + merchant who
--      doesn't already have a balance. Migration 133 seeded the rep row
--      default (500) but skipped the coin grant — this fills that gap so
--      pre-existing accounts aren't penalised relative to fresh signups.
--
--   2. Scale-out indexes on blip_point_log + a `blip_point_transactions`
--      VIEW alias so the table is namedly the "transactions ledger" we
--      promised. The underlying table stays blip_point_log to avoid
--      breaking the existing waitlist code that writes to it directly.
--
-- Re-runnable: starter-coin grant uses a unique source_ref
-- ('legacy_backfill') guarded by the existing partial unique index on
-- (actor, event, source_ref); index creations use IF NOT EXISTS.
--
-- Target scale: 1M users × ~10 events/yr each → ~10M rows in the ledger
-- the first year. The new composite indexes keep the hot reads ("my
-- recent history", "this actor's TRADE_COMPLETED count last 24h") at
-- single-digit ms. Native monthly partitioning of blip_point_log is
-- a follow-up migration once row counts approach 50M.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Starter-coin backfill — 100 Blip Points for every existing actor
--    that doesn't already have a positive balance. We DO NOT overwrite
--    waitlist signup bonuses (users at 200, merchants at 2000); the
--    LEAST() floor only kicks in if blip_points is below 100.
-- ----------------------------------------------------------------------------

-- USERS: insert MANUAL_CREDIT log rows for the bottom slice. The unique
-- index on (actor_type, actor_id, event='MANUAL_CREDIT', source_ref) means
-- repeated runs of this migration are no-ops.
INSERT INTO blip_point_log
  (actor_id, actor_type, event, bonus_points, source_ref, metadata)
SELECT
  u.id,
  'user',
  'MANUAL_CREDIT',
  100,
  'legacy_backfill',
  '{"reason":"legacy_starter_coin_backfill","migration":134}'::jsonb
FROM users u
WHERE COALESCE(u.blip_points, 0) < 100
ON CONFLICT DO NOTHING;

UPDATE users
   SET blip_points = GREATEST(COALESCE(blip_points, 0), 100),
       updated_at  = NOW()
 WHERE COALESCE(blip_points, 0) < 100;

-- MERCHANTS: same treatment. Merchants who already have the 2000
-- waitlist register bonus are left alone.
INSERT INTO blip_point_log
  (actor_id, actor_type, event, bonus_points, source_ref, metadata)
SELECT
  m.id,
  'merchant',
  'MANUAL_CREDIT',
  100,
  'legacy_backfill',
  '{"reason":"legacy_starter_coin_backfill","migration":134}'::jsonb
FROM merchants m
WHERE COALESCE(m.blip_points, 0) < 100
ON CONFLICT DO NOTHING;

UPDATE merchants
   SET blip_points = GREATEST(COALESCE(blip_points, 0), 100),
       updated_at  = NOW()
 WHERE COALESCE(blip_points, 0) < 100;

-- ----------------------------------------------------------------------------
-- 2. Update the idempotency partial index to also cover MANUAL_CREDIT —
--    without this, two backfill runs (e.g. dev + prod) could both insert
--    a 'legacy_backfill' row for the same actor. Recreating the partial
--    index is safe; it's covered by IF NOT EXISTS via DROP/RECREATE in
--    a DO block.
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
-- 3. Scale-out indexes for hot read paths at 1M-user load.
--
--    Each index is a tradeoff: writes get slightly slower, reads get a
--    lot faster. We add only the three queries that show up in the
--    flame graph at scale.
-- ----------------------------------------------------------------------------

-- (a) "Recent activity for actor X" — used by /api/coins/history,
--     admin tools, dispute investigations. The existing
--     idx_blip_point_log_actor covers this but is multi-event-type;
--     a BRIN on created_at keeps it cheap on huge tables.
CREATE INDEX IF NOT EXISTS idx_blip_point_log_created_brin
  ON blip_point_log USING BRIN (created_at);

-- (b) "Sum coins earned by event_type in the last N hours/days" — used
--     by the cap-state recompute (rare but needs to scan a slice).
CREATE INDEX IF NOT EXISTS idx_blip_point_log_event_recent
  ON blip_point_log (event, created_at DESC)
  WHERE bonus_points > 0;

-- (c) "Lifetime earned vs spent per actor" — used by getCoinBalance's
--     lifetime aggregates. The partial helps because spends are a
--     small fraction of total rows.
CREATE INDEX IF NOT EXISTS idx_blip_point_log_actor_signed
  ON blip_point_log (actor_type, actor_id, bonus_points);

-- ----------------------------------------------------------------------------
-- 4. blip_point_transactions VIEW — a friendly alias over blip_point_log
--    so downstream code / admin dashboards can refer to "the transactions
--    table" without having to know the historical name. Read-only view;
--    writes still go through creditPoints / awardCoins / burnCoins.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW blip_point_transactions AS
SELECT
  id,
  actor_id,
  actor_type,
  event              AS event_type,
  bonus_points       AS amount,
  total_points       AS balance_after,
  source_ref,
  metadata,
  created_at
FROM blip_point_log;

-- ----------------------------------------------------------------------------
-- 5. Documentation row count check (for the dev who runs this and
--    wonders if it worked). Emits a notice with backfill volume.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_user_credits int;
  v_merch_credits int;
BEGIN
  SELECT COUNT(*) INTO v_user_credits
    FROM blip_point_log
   WHERE event = 'MANUAL_CREDIT'
     AND source_ref = 'legacy_backfill'
     AND actor_type = 'user';

  SELECT COUNT(*) INTO v_merch_credits
    FROM blip_point_log
   WHERE event = 'MANUAL_CREDIT'
     AND source_ref = 'legacy_backfill'
     AND actor_type = 'merchant';

  RAISE NOTICE '[migration 134] Starter-coin backfill: users=%, merchants=%',
    v_user_credits, v_merch_credits;
END$$;
