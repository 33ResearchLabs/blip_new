-- Migration 123: User rewards ledger
--
-- Per-order rewards granted to the SELLER user when a sell order completes
-- end-to-end (merchant marked payment_sent + user confirmed received +
-- escrow released). 0.2-0.5% of the order's USDT crypto_amount, randomized
-- per order, shown as a scratch-card UI in the wallet.
--
-- One row per order — uniqueness on order_id prevents double-granting if the
-- completion handler retries.

CREATE TABLE IF NOT EXISTS user_rewards (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id          UUID         NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  amount_usdt       NUMERIC(20, 6) NOT NULL CHECK (amount_usdt > 0),
  reward_bps        INTEGER      NOT NULL CHECK (reward_bps BETWEEN 20 AND 50), -- 0.20%–0.50%
  reason            TEXT         NOT NULL DEFAULT 'sell_completed',
  granted_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Whether the user has tapped/scratched the card. Hidden rewards still
  -- count in totals but render with the cover overlay in the UI.
  revealed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_rewards_user_id        ON user_rewards (user_id);
CREATE INDEX IF NOT EXISTS idx_user_rewards_user_granted   ON user_rewards (user_id, granted_at DESC);

COMMENT ON TABLE user_rewards IS
  'Per-order reward credits granted to the selling user. Source of truth for total_rewards display.';
COMMENT ON COLUMN user_rewards.reward_bps IS
  'Randomized 20-50 bps (0.20%-0.50%) of crypto_amount, applied at completion time.';
