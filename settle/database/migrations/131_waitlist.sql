-- 131_waitlist.sql
--
-- Add waitlist support to the existing users and merchants tables. Same auth,
-- same rows, same credentials work pre- and post-launch. A new `waitlist_status`
-- column gates access; existing rows get 'active' so the live app is unaffected.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds waitlist_status / waitlist_joined_at / waitlist_source / blip_points
--      / referral_code / referred_by columns to users and merchants. All
--      existing rows keep the default 'active' status so no live behavior
--      changes.
--   2. Adds merchant business columns (business_category, expected_monthly_volume_usd).
--      `business_name` already exists on merchants (NOT NULL) — we reuse it.
--   3. Creates blip_point_log for an immutable audit trail of every point
--      credit/debit (waitlist airdrop only — not the real-money ledger).
--   4. Creates waitlist_tasks for the social-quest tile system (twitter,
--      telegram, discord, quiz, whitepaper).
--   5. Creates waitlist_referrals to track who referred whom and reward
--      crediting status.
--
-- WHY IDEMPOTENT
--   - Every ADD COLUMN uses IF NOT EXISTS.
--   - Every CREATE TABLE/INDEX uses IF NOT EXISTS.
--   - Backfill UPDATEs are guarded so re-runs are no-ops.
--   - No CONCURRENTLY (migrations run inside transactions).

-- ============================================================================
-- USERS: waitlist columns
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS waitlist_status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS waitlist_joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS waitlist_source text,
  ADD COLUMN IF NOT EXISTS blip_points integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS referred_by_merchant_id uuid;

-- Constrain the enum-like text column (safe to add even if it exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'users_waitlist_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_waitlist_status_check
      CHECK (waitlist_status IN ('waitlisted', 'active', 'rejected'));
  END IF;
END$$;

-- Backfill: any existing NULLs become 'active' (defensive — DEFAULT 'active'
-- already covers new rows). Idempotent because the WHERE clause matches no
-- rows on re-run.
UPDATE users SET waitlist_status = 'active' WHERE waitlist_status IS NULL;

-- Partial index: only index waitlisted rows (cheap and the only query target)
CREATE INDEX IF NOT EXISTS idx_users_waitlist_status
  ON users (waitlist_status)
  WHERE waitlist_status = 'waitlisted';

-- Referral code: unique when set (NULL allowed for legacy rows)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code_unique
  ON users (referral_code)
  WHERE referral_code IS NOT NULL;

-- ============================================================================
-- MERCHANTS: waitlist columns + business profile fields used at signup
-- ============================================================================

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS waitlist_status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS waitlist_joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS waitlist_source text,
  ADD COLUMN IF NOT EXISTS blip_points integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS referred_by_merchant_id uuid,
  ADD COLUMN IF NOT EXISTS business_category text,
  ADD COLUMN IF NOT EXISTS expected_monthly_volume_usd numeric(20,2),
  ADD COLUMN IF NOT EXISTS country_code character varying(8);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'merchants_waitlist_status_check'
  ) THEN
    ALTER TABLE merchants
      ADD CONSTRAINT merchants_waitlist_status_check
      CHECK (waitlist_status IN ('waitlisted', 'active', 'rejected'));
  END IF;
END$$;

UPDATE merchants SET waitlist_status = 'active' WHERE waitlist_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_merchants_waitlist_status
  ON merchants (waitlist_status)
  WHERE waitlist_status = 'waitlisted';

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_referral_code_unique
  ON merchants (referral_code)
  WHERE referral_code IS NOT NULL;

-- ============================================================================
-- blip_point_log: audit trail for waitlist points
-- ============================================================================

CREATE TABLE IF NOT EXISTS blip_point_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL,
  actor_type    text NOT NULL,
  event         text NOT NULL,
  bonus_points  integer NOT NULL,
  total_points  integer,
  metadata      jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'blip_point_log_actor_type_check'
  ) THEN
    ALTER TABLE blip_point_log
      ADD CONSTRAINT blip_point_log_actor_type_check
      CHECK (actor_type IN ('user', 'merchant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'blip_point_log_event_check'
  ) THEN
    ALTER TABLE blip_point_log
      ADD CONSTRAINT blip_point_log_event_check
      CHECK (event IN (
        'REGISTER','MERCHANT_REGISTER',
        'TWITTER_FOLLOW','TELEGRAM_JOIN','DISCORD_JOIN','RETWEET',
        'WHITEPAPER_READ','CROSS_BORDER_SWAP',
        'REFERRAL_BONUS_EARNED','REFERRAL_BONUS_RECEIVED',
        'TASK_VERIFIED','MANUAL_CREDIT','MANUAL_DEBIT'
      ));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_blip_point_log_actor
  ON blip_point_log (actor_type, actor_id, created_at DESC);

-- Prevent double-credit of one-shot register events on race / retry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_blip_point_log_register_once
  ON blip_point_log (actor_type, actor_id, event)
  WHERE event IN ('REGISTER', 'MERCHANT_REGISTER');

-- ============================================================================
-- waitlist_tasks: social/quest tile state
-- ============================================================================

CREATE TABLE IF NOT EXISTS waitlist_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL,
  actor_type    text NOT NULL,
  task_type     text NOT NULL,
  status        text DEFAULT 'PENDING',
  proof_data    jsonb DEFAULT '{}'::jsonb,
  points_awarded integer DEFAULT 0,
  completed_at  timestamptz,
  created_at    timestamptz DEFAULT NOW(),
  updated_at    timestamptz DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'waitlist_tasks_actor_type_check'
  ) THEN
    ALTER TABLE waitlist_tasks
      ADD CONSTRAINT waitlist_tasks_actor_type_check
      CHECK (actor_type IN ('user', 'merchant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'waitlist_tasks_task_type_check'
  ) THEN
    ALTER TABLE waitlist_tasks
      ADD CONSTRAINT waitlist_tasks_task_type_check
      CHECK (task_type IN ('TWITTER','TELEGRAM','DISCORD','QUIZ','WHITEPAPER','CUSTOM'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'waitlist_tasks_status_check'
  ) THEN
    ALTER TABLE waitlist_tasks
      ADD CONSTRAINT waitlist_tasks_status_check
      CHECK (status IN ('PENDING','SUBMITTED','VERIFIED','REJECTED'));
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_tasks_actor_task_unique
  ON waitlist_tasks (actor_type, actor_id, task_type);

CREATE INDEX IF NOT EXISTS idx_waitlist_tasks_status
  ON waitlist_tasks (status);

-- ============================================================================
-- waitlist_referrals: who-referred-whom + reward state
-- ============================================================================

CREATE TABLE IF NOT EXISTS waitlist_referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     uuid NOT NULL,
  referrer_type   text NOT NULL,
  referred_id     uuid NOT NULL,
  referred_type   text NOT NULL,
  referral_code   text NOT NULL,
  reward_status   text DEFAULT 'pending',
  reward_amount   integer DEFAULT 0,
  created_at      timestamptz DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'waitlist_referrals_referrer_type_check'
  ) THEN
    ALTER TABLE waitlist_referrals
      ADD CONSTRAINT waitlist_referrals_referrer_type_check
      CHECK (referrer_type IN ('user', 'merchant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'waitlist_referrals_referred_type_check'
  ) THEN
    ALTER TABLE waitlist_referrals
      ADD CONSTRAINT waitlist_referrals_referred_type_check
      CHECK (referred_type IN ('user', 'merchant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'waitlist_referrals_reward_status_check'
  ) THEN
    ALTER TABLE waitlist_referrals
      ADD CONSTRAINT waitlist_referrals_reward_status_check
      CHECK (reward_status IN ('pending','credited','failed'));
  END IF;
END$$;

-- A given referred actor can only be referred once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_referrals_referred_once
  ON waitlist_referrals (referred_type, referred_id);

CREATE INDEX IF NOT EXISTS idx_waitlist_referrals_referrer
  ON waitlist_referrals (referrer_type, referrer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_waitlist_referrals_code
  ON waitlist_referrals (referral_code);
