-- 137_advanced_threat_detection.sql (Phase A — read-side, additive only)
--
-- Adds the columns and tables needed by the advanced threat-detection system
-- for waitlist signups. Phase A scope: extend risk_profiles with waitlist-
-- specific columns + create risk_labels (admin feedback table for future
-- model calibration). Tables for device fingerprinting, behavioural telemetry,
-- sanctioned-wallet lists, and community membership land in later phases (B-E).
--
-- WHY ADDITIVE-ONLY
--   * Every column is nullable / defaults preserve current behaviour
--   * No existing column types change
--   * No FK constraints on existing tables (cascade-safe)
--   * Existing getRiskProfile() queries that SELECT specific columns continue
--     to compile + return correct data — the wl_* columns just sit unread
--   * Existing /api/admin/waitlist response shape is unchanged at the DB level
--
-- IDEMPOTENT
--   * ADD COLUMN IF NOT EXISTS on every alter
--   * CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS everywhere
--   * No CONCURRENTLY (migrations run inside a transaction)

BEGIN;

-- ============================================================================
-- 1. Extend risk_profiles with waitlist-specific score + audit columns
-- ============================================================================

ALTER TABLE risk_profiles
  ADD COLUMN IF NOT EXISTS wl_score              integer,
  ADD COLUMN IF NOT EXISTS wl_label              text,
  ADD COLUMN IF NOT EXISTS wl_hypothesis         text,
  ADD COLUMN IF NOT EXISTS wl_hypothesis_conf    real,
  ADD COLUMN IF NOT EXISTS wl_confidence         text,
  ADD COLUMN IF NOT EXISTS wl_by_category        jsonb,
  ADD COLUMN IF NOT EXISTS wl_signals            jsonb,
  ADD COLUMN IF NOT EXISTS wl_tier1_flags        jsonb,
  ADD COLUMN IF NOT EXISTS wl_tier3_anomaly      real,
  ADD COLUMN IF NOT EXISTS wl_community_id       text,
  ADD COLUMN IF NOT EXISTS wl_model_version      text,
  ADD COLUMN IF NOT EXISTS wl_recalc_at          timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'risk_profiles_wl_label_check'
  ) THEN
    ALTER TABLE risk_profiles
      ADD CONSTRAINT risk_profiles_wl_label_check
      CHECK (wl_label IS NULL OR wl_label IN
        ('TRUSTED','CLEAN','NEUTRAL','SUSPECT','HIGH_RISK','CRITICAL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'risk_profiles_wl_hypothesis_check'
  ) THEN
    ALTER TABLE risk_profiles
      ADD CONSTRAINT risk_profiles_wl_hypothesis_check
      CHECK (wl_hypothesis IS NULL OR wl_hypothesis IN
        ('NORMAL','BOT_FARM','REFERRAL_RING','SANCTIONED',
         'MONEY_MULE','IDENTITY_FRAUD','LOW_QUALITY'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'risk_profiles_wl_confidence_check'
  ) THEN
    ALTER TABLE risk_profiles
      ADD CONSTRAINT risk_profiles_wl_confidence_check
      CHECK (wl_confidence IS NULL OR wl_confidence IN ('high','medium','low'));
  END IF;
END$$;

-- Filter index: only index rows that have a computed waitlist label
CREATE INDEX IF NOT EXISTS idx_risk_profiles_wl_label
  ON risk_profiles (wl_label)
  WHERE wl_label IS NOT NULL;

-- Sort/range index for score-based ordering
CREATE INDEX IF NOT EXISTS idx_risk_profiles_wl_score
  ON risk_profiles (wl_score DESC)
  WHERE wl_score IS NOT NULL;

-- Used by background recompute scheduler (stale-first)
CREATE INDEX IF NOT EXISTS idx_risk_profiles_wl_recalc
  ON risk_profiles (wl_recalc_at)
  WHERE wl_recalc_at IS NOT NULL;

-- Hypothesis filter (admin UI)
CREATE INDEX IF NOT EXISTS idx_risk_profiles_wl_hypothesis
  ON risk_profiles (wl_hypothesis)
  WHERE wl_hypothesis IS NOT NULL;

-- ============================================================================
-- 2. risk_labels: admin feedback for future combiner calibration
-- ============================================================================
-- Recorded when an admin Activates ("legit") or Rejects ("fraud") a signup.
-- Used by the nightly calibration job (Phase G) to retrain logistic-regression
-- combiner coefficients once enough labels accumulate (≥500).

CREATE TABLE IF NOT EXISTS risk_labels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL,
  actor_type    text NOT NULL,
  label         text NOT NULL,
  -- Snapshot of the score that was visible to the admin when they labelled.
  -- Lets us measure how much the model already agreed with the admin (and
  -- detects drift over time even without retraining).
  score_at_label int,
  label_source  text NOT NULL,    -- 'admin_activate' | 'admin_reject' | 'system_override'
  labeled_by    text,             -- admin identifier (HMAC username)
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'risk_labels_actor_type_check'
  ) THEN
    ALTER TABLE risk_labels
      ADD CONSTRAINT risk_labels_actor_type_check
      CHECK (actor_type IN ('user','merchant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'risk_labels_label_check'
  ) THEN
    ALTER TABLE risk_labels
      ADD CONSTRAINT risk_labels_label_check
      CHECK (label IN ('legit','fraud'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_risk_labels_actor
  ON risk_labels (actor_type, actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_risk_labels_created
  ON risk_labels (created_at DESC);

COMMIT;
