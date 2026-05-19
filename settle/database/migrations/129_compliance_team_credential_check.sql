-- Migration 129: Compliance team must have at least one credential
--
-- Purpose
--   Migration 058 dropped NOT NULL on both `password_hash` and `email`
--   (needed because wallet-auth-only compliance members exist). The
--   side effect: a compliance row can now exist with NO credentials at
--   all — no password, no email, no wallet address. The security review
--   flagged this: a compliance account with no credential is effectively
--   "free admin access waiting to happen" if the row ever has a session
--   minted for it via wallet auth or a bug.
--
-- Fix
--   Add a CHECK constraint requiring at least one of
--     password_hash IS NOT NULL  (password auth)
--     wallet_address IS NOT NULL (wallet auth)
--   Rows with email but no password and no wallet are still rejected —
--   email alone cannot authenticate.
--
-- Zero-regression strategy
--   The constraint is added with `NOT VALID`. That means:
--     • New INSERTs / UPDATEs must satisfy the constraint (gap is closed
--       for all future writes — the core security goal).
--     • Existing rows are NOT re-checked. If any historical row violates
--       the rule, it stays put — no migration failure, no data loss.
--
--   A follow-up ops task should run:
--     SELECT id, email, role FROM compliance_team
--      WHERE password_hash IS NULL AND wallet_address IS NULL;
--   …decide whether to delete or backfill each row, then:
--     ALTER TABLE compliance_team VALIDATE CONSTRAINT compliance_team_has_credential;
--
-- Idempotency
--   Uses DROP CONSTRAINT IF EXISTS so the migration can re-run safely
--   without conflicting with a partial prior application.

DO $$
BEGIN
  -- Drop any previous version (e.g. a re-run, or a prior name)
  ALTER TABLE compliance_team DROP CONSTRAINT IF EXISTS compliance_team_has_credential;

  -- Add the NOT VALID constraint — applies to future writes only
  ALTER TABLE compliance_team
    ADD CONSTRAINT compliance_team_has_credential
    CHECK (password_hash IS NOT NULL OR wallet_address IS NOT NULL)
    NOT VALID;
END $$;
