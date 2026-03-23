-- Migration 046: Link merchant's payment method to orders
-- When a merchant sells crypto (receives fiat), their default payment method
-- is locked into the order so the buyer knows where to send money.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS merchant_payment_method_id UUID REFERENCES merchant_payment_methods(id);

CREATE INDEX IF NOT EXISTS idx_orders_merchant_pm_id
  ON orders(merchant_payment_method_id)
  WHERE merchant_payment_method_id IS NOT NULL;
