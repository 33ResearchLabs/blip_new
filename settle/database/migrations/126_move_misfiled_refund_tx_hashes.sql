-- Migration 126: Move misfiled on-chain refund signatures.
--
-- The payment-deadline-worker historically wrote on-chain refund signatures
-- into `release_tx_hash` (the column for buyer-receives release transactions).
-- This violated column semantics and made it impossible to tell at a glance
-- whether a cancelled order's funds went to the buyer (release) or back to
-- the seller (refund).
--
-- Under correct semantics, a cancelled/expired/disputed order should NEVER
-- have `release_tx_hash` set — release only fires on the happy-path
-- `completed` transition. Two cases to fix:
--
--   1. refund_tx_hash IS NULL  AND  release_tx_hash IS NOT NULL
--      → release_tx_hash holds the refund sig; move it.
--
--   2. refund_tx_hash IS NOT NULL  AND  release_tx_hash IS NOT NULL
--      → refund_tx_hash already correct (recent fix backfilled it); the
--        value in release_tx_hash is the historical misfile. Clear it.
--
-- Idempotent: re-running is a no-op once cleaned.

-- Case 1: copy then clear
UPDATE orders
   SET refund_tx_hash = release_tx_hash,
       release_tx_hash = NULL
 WHERE status IN ('cancelled', 'expired', 'disputed')
   AND escrow_tx_hash IS NOT NULL
   AND release_tx_hash IS NOT NULL
   AND refund_tx_hash IS NULL;

-- Case 2: just clear the historical misfile
UPDATE orders
   SET release_tx_hash = NULL
 WHERE status IN ('cancelled', 'expired', 'disputed')
   AND escrow_tx_hash IS NOT NULL
   AND release_tx_hash IS NOT NULL
   AND refund_tx_hash IS NOT NULL;
