-- 138_device_fingerprints.sql (Phase C — device fingerprinting for waitlist)
--
-- Adds the two tables that store device fingerprints captured at signup time
-- and link them to actors (users + merchants). Used by the Phase C signal
-- detectors (DEVICE_FP_REUSE, DEVICE_FP_LOW_ENTROPY) and the Tier 1
-- DEVICE_FP_REUSE_THRESHOLD hard rule.
--
-- NOTE: There is also a `devices` / `device_users` pair from migration 069
-- used by the order/trade risk system. Those tables are tuned for
-- post-signup activity tracking and live alongside this one. We don't reuse
-- them because:
--   1. Their `device_id` is the existing tracker's hash format — we'd
--      conflict on the PK.
--   2. They don't store per-component data we need for entropy analysis.
--   3. Adding waitlist-specific columns to a hot table risks regressions
--      elsewhere. New tables = zero blast radius.
--
-- ADDITIVE-ONLY — IF NOT EXISTS / IF EXISTS guards everywhere.

BEGIN;

-- ============================================================================
-- 1. device_fingerprints — one row per distinct fingerprint hash
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_fingerprints (
  fp_hash         text PRIMARY KEY,                       -- sha256 of canonical(components)
  visitor_id      text NOT NULL,                          -- shorter human-debug hash (12 char prefix)
  components      jsonb NOT NULL,                         -- canvas, webgl, screen, plugins, hw, tz, ua
  ja3             text,                                   -- reserved — JA3 capture needs reverse-proxy
  first_seen      timestamptz NOT NULL DEFAULT NOW(),
  last_seen       timestamptz NOT NULL DEFAULT NOW(),
  signup_count    integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_device_fingerprints_visitor
  ON device_fingerprints (visitor_id);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_signup_count
  ON device_fingerprints (signup_count DESC)
  WHERE signup_count > 1;

-- ============================================================================
-- 2. actor_device_fingerprints — link table (many-to-many actor ↔ fingerprint)
-- ============================================================================
-- Why a link table and not a column on users/merchants:
--   * One actor can have multiple fingerprints (multiple devices over time)
--   * One fingerprint can be linked to multiple actors (the very signal
--     we're looking for — DEVICE_FP_REUSE)
--   * Keeps the existing users/merchants tables untouched (no risk to
--     existing flows)

CREATE TABLE IF NOT EXISTS actor_device_fingerprints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL,
  actor_type    text NOT NULL,
  fp_hash       text NOT NULL,
  captured_at   timestamptz NOT NULL DEFAULT NOW(),
  source        text NOT NULL DEFAULT 'signup',          -- 'signup' | 'login' (Phase D+)
  -- One link per (actor, fingerprint) — re-captures update the timestamp via
  -- ON CONFLICT in code rather than insert duplicate rows.
  UNIQUE (actor_type, actor_id, fp_hash)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'actor_device_fingerprints_actor_type_check'
  ) THEN
    ALTER TABLE actor_device_fingerprints
      ADD CONSTRAINT actor_device_fingerprints_actor_type_check
      CHECK (actor_type IN ('user','merchant'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_actor_device_fingerprints_actor
  ON actor_device_fingerprints (actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_actor_device_fingerprints_fp
  ON actor_device_fingerprints (fp_hash);

COMMIT;
