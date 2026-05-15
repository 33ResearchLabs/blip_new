-- Migration 125z: Backfill the `refund_tx_hash` column on `orders`.
--
-- The on-chain refund signature column is part of the canonical schema
-- (see settle/database/schema.sql) but no migration ever added it. Fresh
-- environments seeded from schema.sql have it; environments built up by
-- replaying migrations don't, which makes migration 126 — which UPDATEs
-- this column — fail with `42703 column "refund_tx_hash" does not exist`
-- and crashes core-api on startup.
--
-- The filename uses the `125z_` prefix on purpose: the migration runner
-- sorts files with `.sort()` (plain string sort), so this file sits
-- between `125_orders_upi_qr_amount.sql` and
-- `126_move_misfiled_refund_tx_hashes.sql` — meaning it always runs
-- before 126, no matter how the runner picks up new files.
--
-- Idempotent: `IF NOT EXISTS` makes re-runs a no-op so the migration
-- can also be applied safely to environments where the column already
-- exists (those seeded from schema.sql).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refund_tx_hash character varying(128);
