-- 162: Allow the X_VERIFIED event in blip_point_log.
--
-- Verifying an X (Twitter) account now awards a one-time Blip Points bonus
-- (see src/lib/coins/awards.ts → awardXVerified, fired from
-- /api/limits/x-verification). The blip_point_log.event column is guarded by
-- the blip_point_log_event_check CHECK constraint, so the new event value must
-- be added to the allow-list or the award INSERT fails.
--
-- Idempotent: drop-if-exists then re-add, mirroring migration 136. The list is
-- the full current allow-list (131 + 132 + 136) plus 'X_VERIFIED'.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
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
      'PERK_BURN',
      -- Social verification bonus (migration 162)
      'X_VERIFIED'
    ));
END$$;
