-- ============================================================================
-- 143_add_google_oauth.sql
--
-- Adds Google OAuth support to users + merchants.
--
-- Background
-- ----------
-- Existing auth is email/password (with optional Solana wallet linking). We
-- want a "Continue with Google" path on the waitlist (user + merchant roles),
-- the merchant LoginScreen, and the user-app LandingPage. The backend route
-- (/api/auth/google) verifies Google's ID token and either signs in an
-- existing account (matched by google_sub or by verified email) or creates
-- a new row.
--
-- This migration is purely additive: new nullable columns + partial unique
-- indexes on google_sub + lookup indexes on lower(email). No existing rows
-- are modified, no constraints are tightened, no columns are dropped.
-- Idempotent (IF NOT EXISTS everywhere).
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS google_sub varchar(64),
  ADD COLUMN IF NOT EXISTS oauth_provider varchar(20);

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS google_sub varchar(64),
  ADD COLUMN IF NOT EXISTS oauth_provider varchar(20);

-- One Google identity → at most one row per table. Partial index so multiple
-- rows can still have NULL google_sub (password-only / wallet-only accounts).
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique
  ON public.users (google_sub) WHERE google_sub IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS merchants_google_sub_unique
  ON public.merchants (google_sub) WHERE google_sub IS NOT NULL;

-- Case-insensitive email lookups for the "link by verified email" path.
-- Partial because email is nullable on both tables.
CREATE INDEX IF NOT EXISTS users_email_lower_idx
  ON public.users (LOWER(email)) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS merchants_email_lower_idx
  ON public.merchants (LOWER(email)) WHERE email IS NOT NULL;
