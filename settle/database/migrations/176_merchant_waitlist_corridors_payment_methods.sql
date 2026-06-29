-- Migration 176: merchant waitlist trade-corridor + payment-method intent
--
-- The merchant waitlist onboarding now captures two more "intent" fields
-- alongside business_category / expected_monthly_volume_usd / country_code
-- (added in migration 131):
--
--   trade_corridors          — which USDT<->fiat corridors the merchant
--                              intends to serve, e.g. {'USDT_INR','USDT_AED'}.
--   intended_payment_methods — which payment-method types they plan to
--                              support, e.g. {'upi','bank'}.
--
-- These are an expression of INTENT at signup. They are deliberately kept
-- separate from the post-signup merchant_payment_methods table (which holds
-- real account details) and from corridor_prices/corridor_providers (live
-- market config). Surfaced read-only in the admin waitlist detail Overview tab.
--
-- Both are nullable text[] with no default, so existing merchants and any
-- non-waitlist register path are completely unaffected.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS trade_corridors text[];

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS intended_payment_methods text[];
