-- Fix production schema drift surfaced by core-api worker errors:
--
--   ERROR: column "reputation_score" of relation "merchants" does not exist
--   ERROR: column "reputation_score" of relation "users" does not exist
--   ERROR: column "reputation_tier" of relation "users" does not exist
--   ERROR: invalid input syntax for type json — '{"fast_trader"}'
--
-- The reputation worker (apps/core-api/src/reputation/queries.ts) writes a
-- denormalized copy of the score and tier onto merchants/users for fast
-- read access. The columns were referenced in code but never had a paired
-- migration, so production never created them. Logs show the UPDATE failing
-- on every reputation recompute (~5-min cadence).
--
-- The badges JSON error shows a different drift: production ended up with
-- reputation_scores.badges as JSONB while the migration declared TEXT[].
-- We re-pin it to TEXT[] so the worker's array binding stops being
-- mis-parsed as JSON. Local already has TEXT[] so this is a no-op there.
--
-- All operations are idempotent and safe to re-run.

-- ─── merchants: reputation denormalization columns ────────────────────────
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS reputation_score INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS reputation_tier VARCHAR(20) NOT NULL DEFAULT 'newcomer';

-- ─── users: same denormalization ──────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS reputation_score INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS reputation_tier VARCHAR(20) NOT NULL DEFAULT 'newcomer';

-- ─── reputation_scores.badges: re-pin to TEXT[] ───────────────────────────
-- Only converts when the column is currently a JSON-family type. If it's
-- already TEXT[] (as the original migration intended) this DO block is a
-- no-op. The conversion uses jsonb_array_elements_text → array_agg, which
-- correctly maps JSON arrays like ["fast_trader","verified"] back to a
-- Postgres text[] '{fast_trader,verified}'.
DO $$
DECLARE
  current_type TEXT;
BEGIN
  SELECT data_type INTO current_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'reputation_scores'
     AND column_name = 'badges';

  IF current_type IN ('json', 'jsonb') THEN
    ALTER TABLE public.reputation_scores
      ALTER COLUMN badges TYPE TEXT[]
      USING (
        CASE
          WHEN badges IS NULL THEN '{}'::text[]
          WHEN jsonb_typeof(badges::jsonb) = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(badges::jsonb))
          ELSE '{}'::text[]
        END
      );

    ALTER TABLE public.reputation_scores
      ALTER COLUMN badges SET DEFAULT '{}'::text[];
  END IF;
END $$;
