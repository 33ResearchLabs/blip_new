-- 033: Price engine — proof columns on orders + authority/confidence on corridor_prices

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS price_proof_sig        TEXT,
  ADD COLUMN IF NOT EXISTS price_proof_ref_price  DECIMAL(20, 8),
  ADD COLUMN IF NOT EXISTS price_proof_expires_at TIMESTAMP;

ALTER TABLE corridor_prices
  ADD COLUMN IF NOT EXISTS price_authority_pubkey  TEXT,
  ADD COLUMN IF NOT EXISTS confidence              VARCHAR(10) DEFAULT 'low';
