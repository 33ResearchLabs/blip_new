-- Migration 028: Synthetic AED Balance System
-- Adds sAED balances, conversion tracking, and exposure limits
-- Allows merchants to convert USDT ↔ synthetic AED at configurable rates

-- Add sAED balance columns to merchants table
-- Note: Column is named sinr_balance but stores AED fils (100 fils = 1 AED)
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS sinr_balance BIGINT DEFAULT 0 NOT NULL CHECK (sinr_balance >= 0),
  ADD COLUMN IF NOT EXISTS max_sinr_exposure BIGINT CHECK (max_sinr_exposure IS NULL OR max_sinr_exposure >= 0),
  ADD COLUMN IF NOT EXISTS synthetic_rate DECIMAL(10, 4) DEFAULT 3.6700 NOT NULL CHECK (synthetic_rate > 0);

-- Add sAED balance column to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sinr_balance BIGINT DEFAULT 0 NOT NULL CHECK (sinr_balance >= 0);

-- Create synthetic conversions tracking table
CREATE TABLE IF NOT EXISTS synthetic_conversions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Account ownership (matches ledger_entries pattern)
  account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('merchant', 'user')),
  account_id UUID NOT NULL,

  -- Conversion details
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('usdt_to_sinr', 'sinr_to_usdt')),
  amount_in BIGINT NOT NULL CHECK (amount_in > 0),
  amount_out BIGINT NOT NULL CHECK (amount_out > 0),
  rate DECIMAL(10, 4) NOT NULL CHECK (rate > 0),

  -- Balance snapshots for audit (USDT uses DECIMAL, sINR uses BIGINT)
  usdt_balance_before DECIMAL(20, 6) NOT NULL,
  usdt_balance_after DECIMAL(20, 6) NOT NULL,
  sinr_balance_before BIGINT NOT NULL,
  sinr_balance_after BIGINT NOT NULL,

  -- Idempotency (prevents double-conversion on retry)
  idempotency_key VARCHAR(255) UNIQUE,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_synthetic_conversions_account
  ON synthetic_conversions(account_type, account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synthetic_conversions_idempotency
  ON synthetic_conversions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_synthetic_conversions_created
  ON synthetic_conversions(created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE synthetic_conversions IS 'Tracks all USDT ↔ sAED conversions with full audit trail';
COMMENT ON COLUMN merchants.sinr_balance IS 'Synthetic AED balance in fils (100 fils = 1 AED)';
COMMENT ON COLUMN merchants.max_sinr_exposure IS 'Maximum sAED balance allowed (in fils). NULL = unlimited. Used to cap unbacked synthetic currency.';
COMMENT ON COLUMN merchants.synthetic_rate IS 'Conversion rate: 1 USDT = X AED. Used for USDT ↔ sAED conversions.';
COMMENT ON COLUMN users.sinr_balance IS 'Synthetic AED balance in fils (100 fils = 1 AED)';
COMMENT ON COLUMN synthetic_conversions.amount_in IS 'Input amount in smallest units (micro-USDT or fils depending on direction)';
COMMENT ON COLUMN synthetic_conversions.amount_out IS 'Output amount in smallest units (fils or micro-USDT depending on direction)';
COMMENT ON COLUMN synthetic_conversions.idempotency_key IS 'Unique key to prevent duplicate conversions on retry';

-- Update ledger_entries entry_type to support synthetic conversions
-- Drop and recreate the constraint to add SYNTHETIC_CONVERSION type
DO $$
BEGIN
  -- Drop existing constraint if it exists (use pg_catalog for CHECK constraints)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ledger_entries_entry_type_check'
    AND conrelid = 'ledger_entries'::regclass
  ) THEN
    ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_entry_type_check;
  END IF;

  -- Add new constraint with SYNTHETIC_CONVERSION type
  ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (
    entry_type IN (
      'DEPOSIT',
      'WITHDRAWAL',
      'ESCROW_LOCK',
      'ESCROW_RELEASE',
      'ESCROW_REFUND',
      'FEE',
      'FEE_EARNING',
      'ADJUSTMENT',
      'ORDER_PAYMENT',
      'ORDER_RECEIPT',
      'SYNTHETIC_CONVERSION'
    )
  );
END $$;
