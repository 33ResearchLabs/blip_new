-- Migration 026: Track who was debited for escrow (deterministic refund target)
--
-- Previously, cancel/expire paths inferred the escrow payer from order.type
-- and buyer_merchant_id. This is fragile when merchant_id gets reassigned
-- during acceptance. These columns record the actual payer at lock time.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS escrow_debited_entity_type VARCHAR(20)
    CHECK (escrow_debited_entity_type IN ('merchant', 'user')),
  ADD COLUMN IF NOT EXISTS escrow_debited_entity_id UUID,
  ADD COLUMN IF NOT EXISTS escrow_debited_amount NUMERIC(20, 8),
  ADD COLUMN IF NOT EXISTS escrow_debited_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.escrow_debited_entity_type IS 'Who was debited for escrow: merchant or user';
COMMENT ON COLUMN orders.escrow_debited_entity_id IS 'UUID of the entity whose balance was debited';
COMMENT ON COLUMN orders.escrow_debited_amount IS 'Exact amount debited (for deterministic refund)';
COMMENT ON COLUMN orders.escrow_debited_at IS 'When the debit happened';

CREATE INDEX IF NOT EXISTS idx_orders_escrow_debited
  ON orders(escrow_debited_entity_type, escrow_debited_entity_id)
  WHERE escrow_debited_entity_id IS NOT NULL;
