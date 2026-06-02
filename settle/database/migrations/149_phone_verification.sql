-- ============================================================================
-- 149_phone_verification.sql
--
-- Self-service mobile (phone) verification for merchants via AWS SNS SMS OTP.
--
-- Adds:
--   * merchants.phone_verified      — boolean flag, drives the "Verified" badge
--   * merchants.phone_verified_at   — timestamp of the successful verification
--   * phone_verification_codes      — short-lived, hashed 6-digit OTP codes
--
-- Mirrors the existing email-verification model (email_verified +
-- email_verification_tokens, migration 068): the OTP is stored only as a
-- SHA-256 hash, single-use, with an expiry and an attempt counter.
--
-- Safety / backward compatibility:
--   * Purely additive: two new nullable/defaulted columns + one new table.
--   * No drops, no CASCADE, no data backfill. Existing merchants default to
--     phone_verified = false until they verify.
--   * Idempotent (IF NOT EXISTS everywhere) — safe to re-run on every startup.
--
-- Rollback:
--   DROP TABLE IF EXISTS phone_verification_codes;
--   ALTER TABLE merchants DROP COLUMN IF EXISTS phone_verified_at;
--   ALTER TABLE merchants DROP COLUMN IF EXISTS phone_verified;
-- ============================================================================

BEGIN;

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS phone_verification_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  phone        VARCHAR(20) NOT NULL,          -- pending number being verified
  code_hash    VARCHAR(128) NOT NULL,          -- SHA-256 hex of the 6-digit OTP
  attempts     INTEGER NOT NULL DEFAULT 0,     -- failed verify attempts (max 5)
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,                    -- set on success or invalidation
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supports "newest unconsumed code for this merchant" lookups in both routes.
CREATE INDEX IF NOT EXISTS idx_phone_verification_codes_merchant
  ON phone_verification_codes (merchant_id, created_at DESC);

COMMIT;
