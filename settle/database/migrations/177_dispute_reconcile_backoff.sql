-- ─────────────────────────────────────────────────────────────────────
-- 177: Dispute reconciliation backoff
-- ─────────────────────────────────────────────────────────────────────
-- The dispute reconciler (src/workers/disputeReconciler.ts) completes DB
-- finalization for disputes that already settled ON-CHAIN (Released/Refunded)
-- but whose atomicFinalizeDispute did not commit — the blockchain-success +
-- DB-failure / confirmation-timeout / crash window.
--
-- These columns give the reconciler per-order exponential backoff so a single
-- permanently-unreadable order (RPC outage, trade account closed before we
-- could read it, indeterminate refund target) cannot burn the batch every
-- tick. They mirror the refund_retry_* columns added in migration 107.
--
-- Additive only: new nullable / defaulted columns never break existing rows
-- or INSERTs. Safe to re-run.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS dispute_reconcile_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_reconcile_after TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS dispute_reconcile_error TEXT NULL;

-- Partial index matching the reconciler's exact candidate WHERE clause so the
-- scan is an index scan over the small stuck-dispute subset, not a seq scan of
-- all disputed orders.
CREATE INDEX IF NOT EXISTS idx_orders_dispute_reconcile
  ON orders (dispute_reconcile_after NULLS FIRST, id)
  WHERE status = 'disputed'
    AND escrow_tx_hash IS NOT NULL
    AND release_tx_hash IS NULL
    AND refund_tx_hash IS NULL;
