-- ============================================================================
-- 132zz_fix_reputation_scores_badges_type.sql
--
-- Comprehensive repair for the reputation_* table family. The three
-- reputation tables (scores / history / events) were originally
-- created in production by the legacy `PUT /api/reputation` endpoint
-- before migration 030 became a proper migration (see 030's header
-- comment). When 030 finally ran, its `CREATE TABLE IF NOT EXISTS`
-- blocks were no-ops against the pre-existing tables, leaving the
-- production schema permanently drifted from the codebase.
--
-- ── Errors this migration unblocks ──
--
--   1. `42703 column "created_at" does not exist`
--      — Fixed earlier by 132z (column adds on reputation_scores).
--
--   2. `42804 column "badges" is of type jsonb but expression is of
--      type text[]`
--      — 132z couldn't fix it because ADD COLUMN IF NOT EXISTS is
--      name-matched and the existing JSONB column was kept.
--
--   3. `0A000 cannot use subquery in transform expression`
--      — A previous version of THIS file used
--      `ALTER COLUMN ... USING (ARRAY(SELECT jsonb_array_elements_text(...)))`,
--      but Postgres rejects subqueries in transform expressions.
--
-- Same drift surface almost certainly affects reputation_history and
-- reputation_events too (same legacy creator). We add their missing
-- columns + indexes defensively so migration 133's INSERTs and the
-- runtime worker's writes can't be tripped by a column we forgot.
--
-- ── Strategy ──
--
-- For the badges TYPE change we sidestep the subquery rule with the
-- four-step "shadow column" dance, all of which can carry subqueries:
--
--   1. ADD COLUMN badges_new text[] DEFAULT '{}'
--   2. UPDATE table SET badges_new = ... (subqueries OK here)
--   3. ALTER TABLE DROP COLUMN badges
--   4. ALTER TABLE RENAME COLUMN badges_new TO badges
--
-- Wrapped in a DO block guarded by `information_schema` so the whole
-- conversion is a no-op anywhere `badges` is already `text[]` (clean
-- envs where 030 was the first creator).
--
-- Sort order: `132zz_*` runs between `132z_*` (already applied) and
-- `133_reputation_rebase_300_900.sql` (which needs the badges column
-- to be text[]). Same naming trick as `125z_add_refund_tx_hash_to_orders`.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. reputation_history — defensive column + index recovery
--
-- Mirrors migration 030's CREATE TABLE so any column that wasn't there
-- when 030 ran (because the legacy creator skipped it) gets added.
-- All `IF NOT EXISTS` → no-op on clean schemas.
-- ----------------------------------------------------------------------------

ALTER TABLE public.reputation_history
  ADD COLUMN IF NOT EXISTS entity_id          UUID;

ALTER TABLE public.reputation_history
  ADD COLUMN IF NOT EXISTS entity_type        VARCHAR(20);

ALTER TABLE public.reputation_history
  ADD COLUMN IF NOT EXISTS total_score        INTEGER;

ALTER TABLE public.reputation_history
  ADD COLUMN IF NOT EXISTS review_score       INTEGER;

ALTER TABLE public.reputation_history
  ADD COLUMN IF NOT EXISTS execution_score    INTEGER;

ALTER TABLE public.reputation_history
  ADD COLUMN IF NOT EXISTS volume_score       INTEGER;

ALTER TABLE public.reputation_history
  ADD COLUMN IF NOT EXISTS consistency_score  INTEGER;

ALTER TABLE public.reputation_history
  ADD COLUMN IF NOT EXISTS trust_score        INTEGER;

ALTER TABLE public.reputation_history
  ADD COLUMN IF NOT EXISTS tier               VARCHAR(20);

ALTER TABLE public.reputation_history
  ADD COLUMN IF NOT EXISTS recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_reputation_history_entity
  ON public.reputation_history (entity_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_reputation_history_date
  ON public.reputation_history (recorded_at);


-- ----------------------------------------------------------------------------
-- 2. reputation_events — defensive column + index recovery
-- ----------------------------------------------------------------------------

ALTER TABLE public.reputation_events
  ADD COLUMN IF NOT EXISTS entity_id     UUID;

ALTER TABLE public.reputation_events
  ADD COLUMN IF NOT EXISTS entity_type   VARCHAR(20);

ALTER TABLE public.reputation_events
  ADD COLUMN IF NOT EXISTS event_type    VARCHAR(50);

ALTER TABLE public.reputation_events
  ADD COLUMN IF NOT EXISTS score_change  INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.reputation_events
  ADD COLUMN IF NOT EXISTS reason        TEXT;

ALTER TABLE public.reputation_events
  ADD COLUMN IF NOT EXISTS metadata      JSONB;

ALTER TABLE public.reputation_events
  ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_reputation_events_entity
  ON public.reputation_events (entity_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_reputation_events_type
  ON public.reputation_events (event_type);


-- ----------------------------------------------------------------------------
-- 3. reputation_scores.badges — convert JSONB → TEXT[]
--
-- Four-step "shadow column" dance:
--   a) ADD shadow column of the target type
--   b) UPDATE the shadow column from the legacy column (subqueries OK)
--   c) DROP the legacy column
--   d) RENAME the shadow to the canonical name
--
-- Guard skips the whole block if `badges` is already `text[]`, so this
-- is a complete no-op on clean schemas where 030 was the first creator.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  -- Only run if badges is currently jsonb. The information_schema
  -- data_type lookup returns 'jsonb' for the JSONB type and 'ARRAY'
  -- for text[] (with udt_name = '_text'). We branch on that.
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'reputation_scores'
       AND column_name  = 'badges'
       AND data_type    = 'jsonb'
  ) THEN
    -- (a) Shadow column — empty array default so the UPDATE that
    -- follows doesn't need to worry about NULLs for rows that don't
    -- match anything in the CASE expression below.
    ALTER TABLE public.reputation_scores
      ADD COLUMN IF NOT EXISTS badges_new text[] DEFAULT '{}';

    -- (b) Backfill. UPDATE allows subqueries in expressions, unlike
    -- ALTER COLUMN USING, so this is where the legacy JSONB shapes
    -- get unpacked.
    --   - NULL                → empty array
    --   - jsonb array         → element-wise unpack to text[]
    --   - anything else       → empty array (defensive)
    UPDATE public.reputation_scores
       SET badges_new = CASE
             WHEN badges IS NULL THEN ARRAY[]::text[]
             WHEN jsonb_typeof(badges) = 'array' THEN
               ARRAY(SELECT jsonb_array_elements_text(badges))
             ELSE ARRAY[]::text[]
           END;

    -- (c) Drop the legacy JSONB column. No view / FK / trigger
    -- depends on it (verified by repo grep) so the drop is safe.
    ALTER TABLE public.reputation_scores DROP COLUMN badges;

    -- (d) Promote the shadow column to the canonical name.
    ALTER TABLE public.reputation_scores
      RENAME COLUMN badges_new TO badges;

    -- Re-assert the default so the final column shape matches
    -- migration 030's CREATE TABLE byte-for-byte.
    ALTER TABLE public.reputation_scores
      ALTER COLUMN badges SET DEFAULT '{}';
  END IF;
END$$;


-- ----------------------------------------------------------------------------
-- 4. reputation_scores — re-assert 030's indexes (re-run safe; all
--    IF NOT EXISTS). Repeated here so this migration is a
--    self-contained repair if 132z is ever rolled forward in isolation.
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_reputation_scores_entity
  ON public.reputation_scores (entity_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_reputation_scores_tier
  ON public.reputation_scores (tier);

CREATE INDEX IF NOT EXISTS idx_reputation_scores_total
  ON public.reputation_scores (total_score DESC);
