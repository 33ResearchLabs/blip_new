-- Merchant progressive setup onboarding state.
--
-- Tracks per-step completion for the 4-step first-time merchant guide:
--   1. wallet_connected   — merchant.wallet_address present
--   2. payment_method_added — at least one row in merchant_payment_methods
--   3. wallet_funded      — merchant.balance > 0 (USDT)
--   4. first_trade_accepted — completed/in-progress order exists
--
-- This is ADDITIVE to merchants.tour_completed_at (the legacy welcome
-- tour). The two coexist — legacy = one-shot dashboard intro, this =
-- progressive setup checklist. Neither replaces the other.
--
-- Idempotent: re-running the migration is a no-op once the table and
-- backfill have been applied. The grandfather backfill marks every
-- pre-existing merchant as "completed" so the new tour never re-runs
-- for accounts that pre-date this feature.

CREATE TABLE IF NOT EXISTS merchant_onboarding (
  merchant_id          UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  wallet_connected_at  TIMESTAMPTZ,
  payment_method_at    TIMESTAMPTZ,
  wallet_funded_at     TIMESTAMPTZ,
  first_trade_at       TIMESTAMPTZ,
  current_step         SMALLINT NOT NULL DEFAULT 1,
  skipped_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index for the only hot lookup: "merchants with onboarding still
-- in progress." Excludes the (eventually) much larger completed/skipped
-- population so the index stays small.
CREATE INDEX IF NOT EXISTS idx_onboarding_incomplete
  ON merchant_onboarding(merchant_id)
  WHERE completed_at IS NULL AND skipped_at IS NULL;

-- Grandfather every merchant that existed before this feature shipped.
-- They never see the new tour. ON CONFLICT keeps the row stable if the
-- migration is re-applied after a merchant has already advanced steps.
INSERT INTO merchant_onboarding (
  merchant_id,
  wallet_connected_at,
  payment_method_at,
  wallet_funded_at,
  first_trade_at,
  current_step,
  completed_at
)
SELECT
  id,
  created_at,
  created_at,
  created_at,
  created_at,
  5,
  created_at
FROM merchants
ON CONFLICT (merchant_id) DO NOTHING;
