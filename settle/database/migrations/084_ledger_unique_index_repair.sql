-- Migration 084: Repair missing partial unique index on ledger_entries
--
-- Migration 053 was supposed to create idx_ledger_no_duplicate_financial,
-- the partial unique index that backs the ON CONFLICT clause in
-- atomicCancelWithRefund (settle/src/lib/orders/atomicCancel.ts). Production
-- recorded migration 053 as applied, but the index never landed on the
-- ledger_entries table. As a result, every escrow refund attempt fails with
-- PostgreSQL error 42P10:
--
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
--
-- This blocks the payment-deadline worker from refunding any expired
-- escrowed orders, leaving user funds locked indefinitely.
--
-- This migration is fully idempotent (IF NOT EXISTS) so it is safe to
-- re-run on every startup. We have already verified there are no
-- duplicate rows that would block the unique index creation.

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_no_duplicate_financial
  ON ledger_entries (related_order_id, entry_type, account_id)
  WHERE related_order_id IS NOT NULL
    AND entry_type IN ('ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_REFUND', 'FEE');
