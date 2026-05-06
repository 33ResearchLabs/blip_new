-- Add fee_bps and treasury_pubkey to v2_trades.
-- The on-chain Trade PDA already carries both (snapshotted at creation),
-- but the indexer was writing neither — so the web UI displayed 0% fee
-- and had no link to treasury. This adds the columns; the indexer will
-- backfill them from on-chain data on the next process_create_trade.

ALTER TABLE v2_trades
  ADD COLUMN IF NOT EXISTS fee_bps SMALLINT,
  ADD COLUMN IF NOT EXISTS treasury_pubkey TEXT;

-- Re-run-safe: column adds with IF NOT EXISTS, no-op if already there.
