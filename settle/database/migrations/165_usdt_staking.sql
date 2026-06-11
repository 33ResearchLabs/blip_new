-- Migration 165: USDT Staking
--
-- Backs the "Stake USDT" screen reached from the Trading Limits page. Users and
-- merchants stake real USDT (moved from users/merchants.balance) into a position
-- that accrues rewards at an APY and raises their trading-limit floor.
--
-- Accrual is lazy/continuous: rewards are computed on read and materialized into
-- accrued_rewards on every mutation (stake/unstake/claim). No cron required.
--
-- Idempotent and re-runnable (IF NOT EXISTS / DROP-then-CREATE for the CHECK).

-- 1. Per-actor staking position (one row per user/merchant).
CREATE TABLE IF NOT EXISTS staking_positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('user', 'merchant')),
  account_id   UUID NOT NULL,

  -- Staked USDT principal and unclaimed (materialized) rewards.
  principal        DECIMAL(20, 8) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  accrued_rewards  DECIMAL(20, 8) NOT NULL DEFAULT 0 CHECK (accrued_rewards >= 0),
  lifetime_rewards DECIMAL(20, 8) NOT NULL DEFAULT 0 CHECK (lifetime_rewards >= 0),

  -- 800 bps = 8.00% APY (mockup default). Per-row so it can be tuned later.
  apy_bps         INTEGER   NOT NULL DEFAULT 800 CHECK (apy_bps >= 0),
  last_accrued_at TIMESTAMP NOT NULL DEFAULT NOW(),

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (account_type, account_id)
);

CREATE INDEX IF NOT EXISTS idx_staking_positions_actor
  ON staking_positions(account_type, account_id);

-- Count of active stakers (for the "Staked users N+" badge).
CREATE INDEX IF NOT EXISTS idx_staking_positions_active
  ON staking_positions(account_type) WHERE principal > 0;

-- 2. Staking event log (stake / unstake / claim) — audit + history feed.
CREATE TABLE IF NOT EXISTS staking_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('user', 'merchant')),
  account_id   UUID NOT NULL,

  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('STAKE', 'UNSTAKE', 'CLAIM')),
  amount     DECIMAL(20, 8) NOT NULL,

  -- Position state immediately after the event (for the history rows).
  principal_after DECIMAL(20, 8),
  rewards_after   DECIMAL(20, 8),

  metadata   JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staking_events_actor
  ON staking_events(account_type, account_id, created_at DESC);

-- 3. Extend the ledger_entries entry_type CHECK to recognise staking balance
--    movements, so they appear in the unified ledger. Mirrors the full list as
--    last defined in migration 031, plus STAKE / UNSTAKE / STAKE_REWARD.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ledger_entries_entry_type_check'
    AND conrelid = 'ledger_entries'::regclass
  ) THEN
    ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_entry_type_check;
  END IF;

  ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (
    entry_type IN (
      'DEPOSIT', 'WITHDRAWAL',
      'ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_REFUND',
      'FEE', 'FEE_EARNING',
      'ADJUSTMENT', 'ORDER_PAYMENT', 'ORDER_RECEIPT',
      'SYNTHETIC_CONVERSION',
      'CORRIDOR_SAED_LOCK', 'CORRIDOR_SAED_TRANSFER', 'CORRIDOR_FEE',
      'STAKE', 'UNSTAKE', 'STAKE_REWARD'
    )
  );
END $$;

COMMENT ON TABLE staking_positions IS 'Per-actor USDT staking position; principal moved from users/merchants.balance, rewards accrue lazily at apy_bps.';
COMMENT ON TABLE staking_events IS 'Append-only log of stake/unstake/claim actions, backs the staking history feed.';
