-- ============================================================================
-- 132_coins_reputation_merge.sql
--
-- Phase 1 of the Coins + Reputation merge. ADDITIVE ONLY — does not change
-- any existing behaviour. Lays the schema foundation for:
--
--   - Locked coin balances (signup bonus, anti-farming holds)
--   - Per-actor earn caps (daily/monthly windows per event type)
--   - Coin-burn trade-limit unlocks (replaces "boost" entirely)
--   - Device + payment-method dedup tables (sybil / multi-account)
--   - Abuse flag ledger
--   - Extended blip_point_log event enum for trade-driven earns
--
-- Reputation rebasing (0–1000 → 300–900 CIBIL scale) deliberately deferred
-- to a later migration once the calculator change is ready — we don't want
-- the score column to drift mid-flight.
--
-- Scale notes (target: 100M users):
--   - Append-only ledgers (blip_point_log, blip_coin_locks, abuse_flags)
--     get a created_at-DESC index. Native partitioning by month is the
--     plan, but applied in a follow-up once the row counts justify the
--     DDL churn; everything in this file remains compatible with later
--     partitioning since we keep created_at as the natural partition key.
--   - All counters are denormalized onto users/merchants for O(1) reads.
--   - Locked-balance unlock is lazy (computed on read), no scheduled job
--     required.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Locked coin balance — denormalized on users + merchants
-- ----------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locked_blip_points integer NOT NULL DEFAULT 0;

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS locked_blip_points integer NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- 2. blip_coin_locks — time-released holds against the locked_blip_points
--    column. Each row says "X coins are locked for actor Y until ts Z, with
--    this source_event as the reason." On unlock the row is marked released
--    and the denormalized counter ticks down. We void rows wholesale when
--    abuse is confirmed.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blip_coin_locks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL,
  actor_type    text NOT NULL,
  amount        integer NOT NULL,
  source_event  text NOT NULL,
  source_ref    text,
  unlocks_at    timestamptz NOT NULL,
  released_at   timestamptz,
  voided_at     timestamptz,
  void_reason   text,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'blip_coin_locks_actor_type_check'
  ) THEN
    ALTER TABLE blip_coin_locks
      ADD CONSTRAINT blip_coin_locks_actor_type_check
      CHECK (actor_type IN ('user','merchant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'blip_coin_locks_amount_positive'
  ) THEN
    ALTER TABLE blip_coin_locks
      ADD CONSTRAINT blip_coin_locks_amount_positive
      CHECK (amount > 0);
  END IF;
END$$;

-- Hot path: "what locks are still active for this actor right now?"
CREATE INDEX IF NOT EXISTS idx_blip_coin_locks_active
  ON blip_coin_locks (actor_type, actor_id, unlocks_at)
  WHERE released_at IS NULL AND voided_at IS NULL;

-- Sweep path: "which locks need releasing now?"
CREATE INDEX IF NOT EXISTS idx_blip_coin_locks_due
  ON blip_coin_locks (unlocks_at)
  WHERE released_at IS NULL AND voided_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3. blip_coin_caps_state — sliding-window earn caps per (actor, event_type,
--    period). One row per (actor_id, event_type, period_start). Updated
--    atomically when credit() runs. We do NOT delete old rows; a daily prune
--    job (added in a later migration when row counts demand it) trims them.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blip_coin_caps_state (
  actor_id      uuid NOT NULL,
  actor_type    text NOT NULL,
  event_type    text NOT NULL,
  period_kind   text NOT NULL,        -- 'day' | 'month' | 'lifetime'
  period_start  date NOT NULL,        -- UTC date; lifetime uses '1970-01-01'
  count         integer NOT NULL DEFAULT 0,
  amount        integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor_type, actor_id, event_type, period_kind, period_start)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'blip_coin_caps_period_kind_check'
  ) THEN
    ALTER TABLE blip_coin_caps_state
      ADD CONSTRAINT blip_coin_caps_period_kind_check
      CHECK (period_kind IN ('day','month','lifetime'));
  END IF;
END$$;

-- Fast lookup of current period state for a single event_type:
CREATE INDEX IF NOT EXISTS idx_blip_coin_caps_current
  ON blip_coin_caps_state (actor_type, actor_id, event_type, period_start DESC);

-- ----------------------------------------------------------------------------
-- 4. coin_limit_unlocks — purchased trade-limit boosts. Replaces the priority
--    "boost" entirely. Coins are burned (debited via blip_point_log w/ event
--    LIMIT_BUMP_BURN); a row here records the resulting active limit tier and
--    its expiry. We do NOT delete expired rows — they're useful audit data —
--    we just filter `expires_at > NOW()` at read time.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coin_limit_unlocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        uuid NOT NULL,
  actor_type      text NOT NULL,
  tier            text NOT NULL,            -- 'L1' | 'L2' | 'L3' | 'L4'
  daily_limit_usd integer NOT NULL,
  per_trade_usd   integer NOT NULL,
  coins_burned    integer NOT NULL,
  purchased_at    timestamptz NOT NULL DEFAULT NOW(),
  expires_at      timestamptz NOT NULL,
  burn_log_id     uuid REFERENCES blip_point_log(id) ON DELETE SET NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'coin_limit_unlocks_actor_type_check'
  ) THEN
    ALTER TABLE coin_limit_unlocks
      ADD CONSTRAINT coin_limit_unlocks_actor_type_check
      CHECK (actor_type IN ('user','merchant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'coin_limit_unlocks_tier_check'
  ) THEN
    ALTER TABLE coin_limit_unlocks
      ADD CONSTRAINT coin_limit_unlocks_tier_check
      CHECK (tier IN ('L1','L2','L3','L4'));
  END IF;
END$$;

-- "Does this actor have any active unlock right now?" — hot read on every
-- order create. Index can't be partial on `expires_at > NOW()` because
-- NOW() is STABLE (not IMMUTABLE) and Postgres rejects volatile/stable
-- functions in index predicates (42P17). We rely on the expires_at DESC
-- sort instead: a query like
--   WHERE actor_type=$1 AND actor_id=$2 AND expires_at > NOW()
--   ORDER BY expires_at DESC LIMIT 1
-- still uses this index efficiently — Postgres walks the leading actor
-- tuples in DESC order and short-circuits on the first row > NOW().
-- The cost of indexing the few expired rows that linger is negligible
-- compared to the engineering complexity of a rolling re-creation job.
CREATE INDEX IF NOT EXISTS idx_coin_limit_unlocks_active
  ON coin_limit_unlocks (actor_type, actor_id, expires_at DESC);

-- ----------------------------------------------------------------------------
-- 5. device_accounts — sybil dedup. Captured on every successful auth event.
--    Phase 5 wires the middleware that writes here; the table is created now
--    so the schema is stable and we can start writing as soon as the
--    fingerprinting helper lands.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_accounts (
  device_id          text NOT NULL,
  fingerprint_hash   text,
  actor_id           uuid NOT NULL,
  actor_type         text NOT NULL,
  first_seen         timestamptz NOT NULL DEFAULT NOW(),
  last_seen          timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, actor_type, actor_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'device_accounts_actor_type_check'
  ) THEN
    ALTER TABLE device_accounts
      ADD CONSTRAINT device_accounts_actor_type_check
      CHECK (actor_type IN ('user','merchant'));
  END IF;
END$$;

-- "How many distinct accounts share this device?" — the core sybil query.
CREATE INDEX IF NOT EXISTS idx_device_accounts_by_device
  ON device_accounts (device_id);

-- Same idea but via secondary match key (when localStorage gets cleared).
CREATE INDEX IF NOT EXISTS idx_device_accounts_by_fingerprint
  ON device_accounts (fingerprint_hash)
  WHERE fingerprint_hash IS NOT NULL;

-- "Which devices has THIS actor used?" — admin tools.
CREATE INDEX IF NOT EXISTS idx_device_accounts_by_actor
  ON device_accounts (actor_type, actor_id, last_seen DESC);

-- ----------------------------------------------------------------------------
-- 6. payment_method_account_links — PM-hash fan-out dedup. The hash is salted
--    SHA256 of the canonical PM identity (IBAN, UPI ID, wallet address) so
--    the actual PM string isn't repeated outside the methods table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_method_account_links (
  pm_hash       text NOT NULL,
  actor_id      uuid NOT NULL,
  actor_type    text NOT NULL,
  first_seen    timestamptz NOT NULL DEFAULT NOW(),
  last_seen     timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pm_hash, actor_type, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_pm_links_by_hash
  ON payment_method_account_links (pm_hash);

-- ----------------------------------------------------------------------------
-- 7. abuse_flags — manual + automated abuse markers. Voids locked coin rows
--    on confirmed flags (handled in lib/coins/awards.ts, not via trigger,
--    to keep DB free of business logic).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS abuse_flags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL,
  actor_type    text NOT NULL,
  flag_type     text NOT NULL,
  severity      text NOT NULL DEFAULT 'LOW',
  source_ref    text,
  notes         text,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'abuse_flags_actor_type_check'
  ) THEN
    ALTER TABLE abuse_flags
      ADD CONSTRAINT abuse_flags_actor_type_check
      CHECK (actor_type IN ('user','merchant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'abuse_flags_severity_check'
  ) THEN
    ALTER TABLE abuse_flags
      ADD CONSTRAINT abuse_flags_severity_check
      CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_abuse_flags_by_actor
  ON abuse_flags (actor_type, actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_abuse_flags_open
  ON abuse_flags (created_at DESC)
  WHERE resolved_at IS NULL;

-- ----------------------------------------------------------------------------
-- 8. Extend blip_point_log event enum with trade/dispute/streak/spend events.
--    The waitlist enum stays as-is; we add new events for the in-app coin
--    economy. Re-runnable: we drop and recreate the CHECK constraint each
--    time so additions in future migrations are safe.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
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
      -- Existing (waitlist + onboarding)
      'REGISTER','MERCHANT_REGISTER',
      'TWITTER_FOLLOW','TELEGRAM_JOIN','DISCORD_JOIN','RETWEET',
      'WHITEPAPER_READ','CROSS_BORDER_SWAP',
      'REFERRAL_BONUS_EARNED','REFERRAL_BONUS_RECEIVED',
      'TASK_VERIFIED','MANUAL_CREDIT','MANUAL_DEBIT',
      -- New (in-app coin economy)
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

-- ----------------------------------------------------------------------------
-- 8b. blip_point_log.source_ref — anchor for idempotency. Trade-driven
--     events MUST set source_ref to the order_id (or rating_id, etc.)
--     so the unique partial index below blocks double-credit on retries.
-- ----------------------------------------------------------------------------
ALTER TABLE blip_point_log
  ADD COLUMN IF NOT EXISTS source_ref text;

-- One credit per (actor, event, source_ref) for the events that are
-- pinned to a specific order/rating. NULL source_ref allowed for
-- ad-hoc events (manual credit, streaks, etc.).
CREATE UNIQUE INDEX IF NOT EXISTS idx_blip_point_log_idempotent_source
  ON blip_point_log (actor_type, actor_id, event, source_ref)
  WHERE source_ref IS NOT NULL
    AND event IN (
      'FIRST_TRADE',
      'TRADE_COMPLETED',
      'VOLUME_BONUS',
      'FIVE_STAR_RECEIVED',
      'DISPUTE_FREE_MONTH',
      'REFERRAL_TRADE_CREDITED',
      'KYC_COMPLETED'
    );

-- ----------------------------------------------------------------------------
-- 9. Helpful read indexes for the new event_types (the existing
--    idx_blip_point_log_actor index covers most reads, but a partial
--    index on the high-volume TRADE_COMPLETED / VOLUME_BONUS events
--    speeds up cap-window aggregation noticeably at scale).
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_blip_point_log_trade_events
  ON blip_point_log (actor_type, actor_id, created_at DESC)
  WHERE event IN ('TRADE_COMPLETED','VOLUME_BONUS','FIRST_TRADE');

-- ----------------------------------------------------------------------------
-- 10. Migration 132 done.
--     Next phases (separate migrations / code-only PRs):
--       Phase 2: lib/coins/awards.ts + hook into order-complete + nightly
--                streak/dispute-free worker
--       Phase 3: /api/coins/spend/limit-bump + /api/limits/me +
--                createOrder guard reads coin_limit_unlocks
--       Phase 4: rep calculator rebase to 300–900 + UI swap
--       Phase 5: device-id + PM-hash middleware capture
-- ----------------------------------------------------------------------------
