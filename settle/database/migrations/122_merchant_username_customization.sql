-- Track when a merchant first customizes their auto-generated username.
--
-- Register flow already auto-generates a username from business_name
-- (see /api/auth/merchant register action). This migration adds the
-- field needed to detect "is this still the default?" so the onboarding
-- tour can prompt the merchant to personalize it.
--
-- Layout:
--   merchants.username_customized_at         — authoritative source of truth
--   merchant_onboarding.username_set_at      — sticky timestamp mirror
--
-- The repository read path (getOnboardingStatus) copies the truth from
-- merchants into merchant_onboarding on first observation, matching the
-- same pattern used for wallet_connected_at, payment_method_at, etc.
--
-- Idempotent — re-running the migration is a no-op once columns exist
-- and the grandfather backfill has populated existing rows.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS username_customized_at TIMESTAMPTZ;

ALTER TABLE merchant_onboarding
  ADD COLUMN IF NOT EXISTS username_set_at TIMESTAMPTZ;

-- Grandfather only merchants that the migration-121 backfill already
-- treated as pre-feature (completed_at set). This avoids re-grandfathering
-- merchants that registered between the 121 and 122 deploys — those
-- accounts should still see the customize-username prompt.
UPDATE merchants m
   SET username_customized_at = m.created_at
  FROM merchant_onboarding mo
 WHERE mo.merchant_id = m.id
   AND mo.completed_at IS NOT NULL
   AND m.username_customized_at IS NULL;

UPDATE merchant_onboarding mo
   SET username_set_at = m.created_at
  FROM merchants m
 WHERE mo.merchant_id = m.id
   AND mo.completed_at IS NOT NULL
   AND mo.username_set_at IS NULL;
