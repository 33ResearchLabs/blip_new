-- User-side email verification + password recovery.
-- Mirrors the merchant infrastructure (migrations 038 + 068) but scoped to
-- the users table. Two new token tables (instead of extending the existing
-- merchant-only tables) so the merchant flow stays untouched.

-- 1. email_verified flag on users (defaults false; existing rows get true
--    so legacy users aren't suddenly locked out).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
UPDATE users SET email_verified = true WHERE email_verified IS NULL;

-- 2. Unique email index (case-insensitive). Partial — only enforced when
--    email is set, since legacy users may have NULL email.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
  ON users (LOWER(email))
  WHERE email IS NOT NULL;

-- 3. Email verification tokens for users.
CREATE TABLE IF NOT EXISTS user_email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_email_verify_token
  ON user_email_verification_tokens (token_hash)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_email_verify_user
  ON user_email_verification_tokens (user_id);

-- 4. Password reset tokens for users.
CREATE TABLE IF NOT EXISTS user_password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_reset_tokens_hash
  ON user_password_reset_tokens (token_hash)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_reset_tokens_expires
  ON user_password_reset_tokens (expires_at);
