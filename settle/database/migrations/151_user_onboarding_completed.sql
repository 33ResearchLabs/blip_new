-- ============================================================================
-- 151_user_onboarding_completed.sql
--
-- Server-side record of whether a user has finished the first-run onboarding
-- flow (welcome screens → pick username → set App Lock PIN).
--
-- Until now this state lived ONLY in the browser under localStorage key
-- `blip_onb_v1_<userId>`, so it was per-device: a user who finished onboarding
-- on their phone would see it again on the web, and the server had no way to
-- query "who has completed onboarding". This column makes the DB the source of
-- truth; localStorage stays as a no-flicker cache on the client.
--
-- Mirrors the merchant side, which already persists completion in
-- merchant_onboarding.completed_at / merchants.tour_completed_at.
--
-- Safety / backward compatibility:
--   * Purely additive: one new nullable column. No drops, no CASCADE, no
--     backfill. Existing users default to NULL (= not completed) and will be
--     marked the next time they finish (or have already finished) the flow.
--   * Idempotent (IF NOT EXISTS) — safe to re-run on every startup.
--
-- Rollback:
--   ALTER TABLE users DROP COLUMN IF EXISTS onboarding_completed_at;
-- ============================================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMIT;
