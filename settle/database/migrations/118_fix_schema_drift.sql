-- Fix production schema drift surfaced by core-api worker errors:
--
--   ERROR: column "reputation_score" of relation "merchants" does not exist
--   ERROR: column "reputation_score" of relation "users" does not exist
--   ERROR: column "reputation_tier" of relation "users" does not exist
--
-- The reputation worker (apps/core-api/src/reputation/queries.ts) writes a
-- denormalized copy of the score and tier onto merchants/users for fast
-- read access. The columns were referenced in code but never had a paired
-- migration, so production never created them. Logs show the UPDATE failing
-- on every reputation recompute (~5-min cadence).
--
-- All operations are idempotent and safe to re-run.
--
-- NOTE: a previous version of this migration also tried to re-pin
-- reputation_scores.badges from JSONB → TEXT[] on production. That ALTER
-- COLUMN TYPE failed with Postgres 0A000 (feature_not_supported) because
-- the migration runner wraps everything in a single transaction and
-- ALTER COLUMN TYPE has interactions (existing default, nested USING) that
-- the transaction context rejected. The whole migration rolled back, so
-- the column-adds below never landed either. The badges issue is a
-- *separate* problem and is now handled in the worker code itself
-- (reputation/queries.ts) — leaving the schema alone keeps this
-- migration safe and idempotent.

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
