-- Migration 136: merchant onboarding form (Google Form webhook)
--
-- Adds the plumbing for the "Join Merchant On Board Program" tile on the
-- waitlist dashboard to actually credit +500 BLIP when the user submits the
-- linked Google Form. The webhook at /api/waitlist/onboard-form-webhook
-- (called from a Google Apps Script trigger on the form's responses sheet)
-- writes one row per submission.
--
-- Schema changes:
--   1. Extend waitlist_tasks.task_type CHECK constraint to include
--      'ONBOARD_FORM' so a verified task can be persisted under the
--      existing (actor_type, actor_id, task_type) unique index. That index
--      gives us the idempotency guarantee — a duplicate webhook fire from
--      Apps Script (network retry, manual replay) cannot create a second
--      task row, and verifyAndCreditTask short-circuits on already-VERIFIED.
--
--   2. Extend blip_point_log.event CHECK constraint to include
--      'MERCHANT_ONBOARD_FORM' so creditPoints can write the audit row.
--
-- Re-runnable: both CHECK constraints are dropped and recreated, matching
-- the pattern established by migration 132. Idempotency works on existing
-- rows because the unique indices are already in place from migration 131.

DO $$
BEGIN
  -- ── waitlist_tasks.task_type ─────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'waitlist_tasks_task_type_check'
  ) THEN
    ALTER TABLE waitlist_tasks
      DROP CONSTRAINT waitlist_tasks_task_type_check;
  END IF;

  ALTER TABLE waitlist_tasks
    ADD CONSTRAINT waitlist_tasks_task_type_check
    CHECK (task_type IN (
      'TWITTER','TELEGRAM','DISCORD','QUIZ','WHITEPAPER','CUSTOM',
      'ONBOARD_FORM'
    ));

  -- ── blip_point_log.event ─────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'blip_point_log_event_check'
  ) THEN
    ALTER TABLE blip_point_log
      DROP CONSTRAINT blip_point_log_event_check;
  END IF;

  ALTER TABLE blip_point_log
    ADD CONSTRAINT blip_point_log_event_check
    CHECK (event IN (
      -- Waitlist + onboarding (migrations 131, 136)
      'REGISTER','MERCHANT_REGISTER',
      'TWITTER_FOLLOW','TELEGRAM_JOIN','DISCORD_JOIN','RETWEET',
      'WHITEPAPER_READ','CROSS_BORDER_SWAP',
      'REFERRAL_BONUS_EARNED','REFERRAL_BONUS_RECEIVED',
      'TASK_VERIFIED','MANUAL_CREDIT','MANUAL_DEBIT',
      'MERCHANT_ONBOARD_FORM',
      -- In-app coin economy (migration 132)
      'FIRST_TRADE',
      'TRADE_COMPLETED',
      'VOLUME_BONUS',
      'STREAK_7','STREAK_30',
      'DISPUTE_FREE_MONTH',
      'FIVE_STAR_RECEIVED',
      'REFERRAL_TRADE_CREDITED',
      'KYC_COMPLETED',
      'COIN_LOCK','COIN_UNLOCK','COIN_VOID',
      'LIMIT_BUMP_BURN',
      'PERK_BURN'
    ));
END$$;

-- Belt-and-braces idempotency: a partial unique index on
-- (actor_type, actor_id, event) restricted to MERCHANT_ONBOARD_FORM rows
-- so even if the webhook bypassed verifyAndCreditTask (e.g. future direct
-- creditPoints call), the DB still refuses a second credit per actor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_blip_point_log_onboard_form_once
  ON blip_point_log (actor_type, actor_id, event)
  WHERE event = 'MERCHANT_ONBOARD_FORM';
