-- Migration 124: User rewards pending → claimable → voided lifecycle
--
-- Previously rewards were inserted only when a SELL order reached `completed`.
-- The QR/UPI consumer flow now grants the reward row at order creation so we
-- can show the scratch-card immediately on the tracking page; the reward
-- stays NON-withdrawable until the trade completes.
--
-- State machine on this row:
--   claimable_at IS NULL  AND voided_at IS NULL  → pending  (visible, not withdrawable)
--   claimable_at IS NOT NULL AND voided_at IS NULL → claimable (withdrawable)
--   voided_at IS NOT NULL                        → voided   (hidden, kept for audit)
--
-- voided_reason values: 'order_cancelled', 'order_expired', 'dispute_refund'.

ALTER TABLE user_rewards
  ADD COLUMN IF NOT EXISTS claimable_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_user_rewards_user_claimable
  ON user_rewards (user_id)
  WHERE claimable_at IS NOT NULL AND voided_at IS NULL;

-- Backfill: any row that exists from before this migration was granted under
-- the old completion-only rule, so it is already claimable.
UPDATE user_rewards
   SET claimable_at = granted_at
 WHERE claimable_at IS NULL AND voided_at IS NULL;

COMMENT ON COLUMN user_rewards.claimable_at IS
  'NULL = pending (trade still running). NOT NULL = order completed, reward is withdrawable.';
COMMENT ON COLUMN user_rewards.voided_at IS
  'NULL = active. NOT NULL = order failed (cancel/expire/dispute refund); reward excluded from totals.';
COMMENT ON COLUMN user_rewards.voided_reason IS
  'order_cancelled | order_expired | dispute_refund — see payment-deadline-worker / atomicCancelWithRefund.';
