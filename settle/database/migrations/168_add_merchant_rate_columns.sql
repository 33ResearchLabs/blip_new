-- Migration 168: Add buy_rate / sell_rate to merchants
--
-- The app code (repositories/merchants.ts, repositories/merchantOnboarding.ts,
-- lib/types/database.ts) reads and writes merchants.buy_rate / sell_rate, but no
-- prior migration ever created the columns. As a result /api/onboarding/status —
-- which runs `SELECT wallet_address, bio, buy_rate, sell_rate FROM merchants` —
-- fails with PostgreSQL 42703 ("column \"buy_rate\" does not exist") and returns
-- a 500, breaking the merchant dashboard's onboarding gate.
--
-- Idempotent + additive: nullable, no default, so existing rows get NULL (which
-- matches the `number | null` type). ADD COLUMN IF NOT EXISTS makes it safe to
-- re-run and a no-op where the columns already exist; a nullable column with no
-- default is a metadata-only change in Postgres (no table rewrite / lock).

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS buy_rate  NUMERIC;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS sell_rate NUMERIC;
