-- Merchant liveness (face) verification — mirrors migration 163 for users.
-- Lets the shared Trading Limits "Verify Liveness" row work for merchants and
-- feed the verification-floor layer in getEffectiveLimits.
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS face_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS face_verified_at TIMESTAMPTZ;
