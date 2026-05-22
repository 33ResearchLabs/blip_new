-- ============================================================================
-- 132zz_fix_reputation_scores_badges_type.sql
--
-- Coerces `reputation_scores.badges` from JSONB → TEXT[] on production.
-- Sequel to 132z which fixed the missing columns but couldn't change
-- the badges TYPE (ADD COLUMN IF NOT EXISTS is a no-op when the column
-- already exists, regardless of declared type).
--
-- The drift: production's `reputation_scores` was originally built by
-- the legacy `PUT /api/reputation` endpoint with `badges JSONB`, but
-- migration 030 declared the canonical type as `TEXT[]`. The two
-- diverged silently until migration 133's `INSERT ... ARRAY[]::text[]`
-- hit the prod schema and failed:
--
--   error: column "badges" is of type jsonb but expression is of type
--   text[]  (PG code 42804)
--
-- Migration 118 noted this issue but couldn't fix it inside the
-- migration runner's transaction — the naïve `ALTER COLUMN TYPE`
-- threw `0A000 feature_not_supported` because the existing JSONB
-- DEFAULT can't be implicitly cast to TEXT[]. The fix is to peel
-- those operations apart:
--
--   1. DROP DEFAULT       (removes the incompatible default expression)
--   2. ALTER ... TYPE ... USING ...  (the actual type change)
--   3. SET DEFAULT '{}'   (restore the canonical default)
--
-- Wrapped in a DO block with an `information_schema` guard so it's a
-- complete no-op on any environment where `badges` is already TEXT[].
--
-- Sort order: `132zz_*` lands between `132z_*` (already applied) and
-- `133_reputation_rebase_300_900.sql` (the failing migration). The
-- migration runner uses a plain JS string sort.
-- ============================================================================

DO $$
BEGIN
  -- Only act if production still has the legacy JSONB column. On any
  -- env where 030 was the first creator (badges = text[]), this whole
  -- block is skipped.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'reputation_scores'
      AND column_name  = 'badges'
      AND data_type    = 'jsonb'
  ) THEN
    -- Step 1: drop the JSONB default. Keeping it would block the type
    -- change with `0A000 feature_not_supported`, which is the exact
    -- failure mode migration 118's earlier attempt hit.
    ALTER TABLE public.reputation_scores
      ALTER COLUMN badges DROP DEFAULT;

    -- Step 2: coerce the column. The USING expression has to handle
    -- every shape the legacy JSONB column might contain:
    --   - NULL              → empty array (TEXT[] is NOT NULL-by-default
    --                         via the restored default below, but the
    --                         USING runs before that, so handle NULL
    --                         here)
    --   - JSONB array       → element-wise unpack to TEXT[]
    --   - anything else     → empty array (defensive fallback for the
    --                         legacy code path that may have written
    --                         a `{}` object or scalar by mistake)
    ALTER TABLE public.reputation_scores
      ALTER COLUMN badges TYPE TEXT[]
      USING (
        CASE
          WHEN badges IS NULL THEN ARRAY[]::TEXT[]
          WHEN jsonb_typeof(badges) = 'array' THEN
            ARRAY(SELECT jsonb_array_elements_text(badges))
          ELSE ARRAY[]::TEXT[]
        END
      );

    -- Step 3: restore the default — same shape as migration 030's
    -- CREATE TABLE so the column is now byte-for-byte equivalent to a
    -- clean install.
    ALTER TABLE public.reputation_scores
      ALTER COLUMN badges SET DEFAULT '{}';
  END IF;
END$$;
