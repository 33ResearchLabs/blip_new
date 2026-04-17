-- Migration 098: Track orphaned escrows (locked on-chain but order creation failed)
-- This allows admin to find and refund stuck escrow funds.

CREATE TABLE IF NOT EXISTS orphaned_escrows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_tx_hash  TEXT NOT NULL,
  merchant_id     UUID REFERENCES merchants(id),
  amount          NUMERIC(20,6) NOT NULL,
  error_message   TEXT,
  escrow_trade_id TEXT,
  escrow_trade_pda TEXT,
  escrow_pda      TEXT,
  escrow_creator_wallet TEXT,
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID,
  resolution_note TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orphaned_escrows_merchant ON orphaned_escrows (merchant_id);
CREATE INDEX IF NOT EXISTS idx_orphaned_escrows_unresolved ON orphaned_escrows (created_at DESC) WHERE resolved_at IS NULL;
