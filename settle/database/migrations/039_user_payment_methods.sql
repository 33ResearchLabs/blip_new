-- Migration 039: User Payment Methods system
-- Allows users/merchants to save multiple payment methods (UPI, Bank, etc.)
-- Orders reference a single payment_method_id for the fiat receiver's chosen method.

-- 1. Payment method type enum
DO $$ BEGIN
  CREATE TYPE payment_method_type AS ENUM ('bank', 'upi', 'cash', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. User payment methods table
CREATE TABLE IF NOT EXISTS user_payment_methods (
  id          UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        payment_method_type NOT NULL,
  label       VARCHAR(100) NOT NULL,           -- e.g. "Emirates NBD - Salary", "PhonePe UPI"
  details     JSONB NOT NULL DEFAULT '{}',     -- Structured details per type
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
  updated_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
);

-- Details JSONB shape per type:
-- bank:  { bank_name, account_name, iban }
-- upi:   { upi_id, provider }                 -- e.g. "user@oksbi", provider: "Google Pay"
-- cash:  { location_name, location_address, meeting_instructions }
-- other: { method_name, account_identifier, instructions }

COMMENT ON TABLE user_payment_methods IS 'Saved payment methods per user. One user can have many; one order selects exactly one.';

-- 3. Add payment_method_id to orders (nullable for backward compat with existing orders)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES user_payment_methods(id);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_upm_user_active
  ON user_payment_methods(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_orders_payment_method_id
  ON orders(payment_method_id)
  WHERE payment_method_id IS NOT NULL;

-- 5. Migrate existing user_bank_accounts into user_payment_methods
-- This preserves existing data while moving to the new system
INSERT INTO user_payment_methods (user_id, type, label, details, is_active)
SELECT
  uba.user_id,
  'bank'::payment_method_type,
  uba.bank_name,
  jsonb_build_object(
    'bank_name', uba.bank_name,
    'account_name', uba.account_name,
    'iban', uba.iban
  ),
  true
FROM user_bank_accounts uba
ON CONFLICT DO NOTHING;
