-- Migration 100: deterministic fee snapshots on orders.
--
-- Adds the fields the UI needs to compute the exact payout at every phase
-- without ever re-fetching a live rate or second-guessing on-chain math.
--
--   fee_bps               — basis-points fee snapshot (matches on-chain trade.fee_bps)
--   final_payout_base     — actual lamports credited to counterparty on release
--   final_fee_base        — actual lamports credited to treasury on release
--   final_mint_decimals   — mint decimals snapshot (USDT=6); prevents drift if mint changes

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fee_bps              SMALLINT,
  ADD COLUMN IF NOT EXISTS final_payout_base    NUMERIC(20, 0),
  ADD COLUMN IF NOT EXISTS final_fee_base       NUMERIC(20, 0),
  ADD COLUMN IF NOT EXISTS final_mint_decimals  SMALLINT DEFAULT 6;

-- Backfill fee_bps from the existing float fee_percentage on legacy orders
-- (best-effort; may be null if legacy rows have no fee recorded).
UPDATE orders
SET fee_bps = ROUND((protocol_fee_percentage * 100)::numeric)::smallint
WHERE fee_bps IS NULL
  AND protocol_fee_percentage IS NOT NULL;

COMMENT ON COLUMN orders.fee_bps             IS 'Fee in basis points, snapshot at create. Mirrors on-chain trade.fee_bps.';
COMMENT ON COLUMN orders.final_payout_base   IS 'u64 lamports credited to counterparty on on-chain release. Null until Released.';
COMMENT ON COLUMN orders.final_fee_base      IS 'u64 lamports credited to treasury on on-chain release. Null until Released.';
COMMENT ON COLUMN orders.final_mint_decimals IS 'Mint decimals snapshot for final_* base-unit fields.';
