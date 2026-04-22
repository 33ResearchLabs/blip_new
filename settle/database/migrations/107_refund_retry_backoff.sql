-- ─────────────────────────────────────────────────────────────────────
-- 107: Refund retry backoff
-- ─────────────────────────────────────────────────────────────────────
-- The payment-deadline worker's processStuckOnChainEscrows job polls every
-- 30s and re-tries failed on-chain refunds with no backoff — so a single
-- persistently failing order (e.g. backend signer lost on-chain authority,
-- malformed trade PDA, RPC outage) burns retries forever and fills the
-- worker's batch, pushing out legitimate candidates.
--
-- These two columns let the worker:
--   1. Skip orders whose next retry time hasn't arrived yet.
--   2. Grow the delay exponentially per failure, capped by app logic.
--
-- The manual "Claim refund" API path intentionally ignores these columns —
-- a user tap should always attempt immediately, regardless of the worker's
-- schedule.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refund_retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_retry_after TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS refund_last_error TEXT NULL;

-- Partial index matching the worker's exact WHERE clause so the lookup is
-- an index scan on the small stuck-order subset, not a seq scan of all
-- terminal orders.
CREATE INDEX IF NOT EXISTS idx_orders_stuck_refund_retry
  ON orders (refund_retry_after NULLS FIRST, id)
  WHERE status IN ('expired', 'cancelled', 'disputed')
    AND escrow_tx_hash IS NOT NULL
    AND release_tx_hash IS NULL;
