-- Track when a user first customizes their auto-generated username.
--
-- Both signup paths auto-assign a username the user did NOT pick:
--   • wallet signup → `user_<...>` placeholder
--   • Google signup → derived from the email local-part
--                      (deriveUniqueGoogleUsername), e.g.
--                      gorav.researchlab@gmail.com → "gorav_researchlab"
--
-- The email-derived form carries no marker, so the old "starts with user_"
-- heuristic wrongly treated Google handles as already-chosen and locked the
-- onboarding "pick a username" step. This column is the authoritative
-- "did the user actually choose this?" signal:
--   NULL  → still the auto-assigned default; the onboarding step may edit it.
--   set   → the user committed to it; username is locked (set-once).
-- Mirrors merchants.username_customized_at (migration 122).
--
-- No grandfather backfill: existing rows stay NULL so anyone who never
-- explicitly chose a handle can still pick one. Onboarding shows once per
-- user, so this does not re-prompt established accounts.
--
-- Idempotent — re-running is a no-op once the column exists.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username_customized_at TIMESTAMPTZ;
