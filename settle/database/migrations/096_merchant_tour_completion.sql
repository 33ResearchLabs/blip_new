-- Migration 096: DB-backed tour completion tracking
--
-- BACKGROUND:
-- The merchant onboarding tour (useMerchantTour hook) currently tracks
-- completion in browser localStorage only. This means the tour re-runs
-- on every fresh browser / incognito window / cleared site data — even
-- for merchants who have completed it before. Users complained that the
-- tour "shows every time".
--
-- FIX:
-- Add `tour_completed_at` to the merchants table so completion state is
-- tied to the merchant account, not the browser. The hook will fall back
-- to localStorage when the DB value is unavailable (e.g. first render
-- before auth response lands), so this remains fully backward-compatible.
--
-- SAFETY:
-- - Pure ADD COLUMN IF NOT EXISTS with NULL default → zero impact on
--   existing rows, existing INSERTs continue to work.
-- - No constraints, no index (read path is a single row lookup during
--   auth; no hot query plan to optimize).
-- - Idempotent and re-runnable.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS tour_completed_at TIMESTAMPTZ NULL;
