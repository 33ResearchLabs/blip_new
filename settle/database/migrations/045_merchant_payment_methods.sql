-- Migration 045: Merchant Payment Methods
-- Dedicated table for merchant payment methods (separate from user_payment_methods).
-- Persists methods added via the merchant dashboard PaymentMethodModal.

CREATE TABLE IF NOT EXISTS merchant_payment_methods (
  id            UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
  merchant_id   UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  type          VARCHAR(20) NOT NULL CHECK (type IN ('bank', 'cash', 'crypto', 'card', 'mobile')),
  name          VARCHAR(200) NOT NULL,
  details       TEXT NOT NULL DEFAULT '',
  is_default    BOOLEAN NOT NULL DEFAULT false,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
  updated_at    TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
);

COMMENT ON TABLE merchant_payment_methods IS 'Saved payment methods per merchant. Displayed in the merchant dashboard modal.';

-- Fast lookup of a merchant''s active methods
CREATE INDEX IF NOT EXISTS idx_mpm_merchant_active
  ON merchant_payment_methods(merchant_id, is_active);

-- Ensure only one default per merchant
CREATE UNIQUE INDEX IF NOT EXISTS idx_mpm_merchant_default
  ON merchant_payment_methods(merchant_id)
  WHERE is_default = true AND is_active = true;
