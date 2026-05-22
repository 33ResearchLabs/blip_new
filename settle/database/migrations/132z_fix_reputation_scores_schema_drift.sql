-- ============================================================================
-- 132z_fix_reputation_scores_schema_drift.sql
--
-- Repairs production schema drift on `reputation_scores`. The table was
-- originally created in production by the old `PUT /api/reputation`
-- endpoint (see migration 030's header comment), which built only the
-- columns it needed. When 030 later became a proper migration, its
-- `CREATE TABLE IF NOT EXISTS` was a no-op against the pre-existing
-- table, so the missing columns never landed.
--
-- The drift surfaced on prod when migration 133 (reputation rebase 300–
-- 900) tried to `INSERT INTO reputation_scores (..., created_at,
-- updated_at) ...`:
--
--   [FATAL] Startup pre-flight failed: error: column "created_at" of
--   relation "reputation_scores" does not exist (PG code 42703)
--
-- The migration runner only treats "already exists" errors as idempotent
-- (see ALREADY_EXISTS_CODES in apps/core-api/src/migrationRunner.ts).
-- 42703 (undefined_column) is fatal — core-api boot aborts, every later
-- migration is skipped.
--
-- This file is named `132z_*` so the migration runner's string sort
-- places it AFTER `132_coins_reputation_merge.sql` but BEFORE
-- `133_reputation_rebase_300_900.sql`. The same trick is used by
-- `125z_add_refund_tx_hash_to_orders.sql`.
--
-- Every column listed below uses `ADD COLUMN IF NOT EXISTS`, so this
-- migration is a no-op on any environment where `reputation_scores`
-- was correctly created from migration 030. Production gets the
-- missing columns; everything else stays unchanged.
-- ============================================================================

-- The full column set declared by migration 030's CREATE TABLE. We
-- add them defensively because we know production created the table
-- through a non-migration path; we don't know which of 030's columns
-- it shipped and which it didn't.

ALTER TABLE public.reputation_scores
  ADD COLUMN IF NOT EXISTS total_score        INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.reputation_scores
  ADD COLUMN IF NOT EXISTS review_score       INTEGER NOT NULL DEFAULT 50;

ALTER TABLE public.reputation_scores
  ADD COLUMN IF NOT EXISTS execution_score    INTEGER NOT NULL DEFAULT 50;

ALTER TABLE public.reputation_scores
  ADD COLUMN IF NOT EXISTS volume_score       INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.reputation_scores
  ADD COLUMN IF NOT EXISTS consistency_score  INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.reputation_scores
  ADD COLUMN IF NOT EXISTS trust_score        INTEGER NOT NULL DEFAULT 50;

ALTER TABLE public.reputation_scores
  ADD COLUMN IF NOT EXISTS tier               VARCHAR(20) NOT NULL DEFAULT 'newcomer';

ALTER TABLE public.reputation_scores
  ADD COLUMN IF NOT EXISTS badges             TEXT[] DEFAULT '{}';

ALTER TABLE public.reputation_scores
  ADD COLUMN IF NOT EXISTS calculated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.reputation_scores
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.reputation_scores
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Recreate the indexes from migration 030 in case any of them were
-- skipped when 030 ran against the drifted table. All `IF NOT EXISTS`,
-- all no-ops on a clean schema.
CREATE INDEX IF NOT EXISTS idx_reputation_scores_entity
  ON public.reputation_scores(entity_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_reputation_scores_tier
  ON public.reputation_scores(tier);

CREATE INDEX IF NOT EXISTS idx_reputation_scores_total
  ON public.reputation_scores(total_score DESC);
