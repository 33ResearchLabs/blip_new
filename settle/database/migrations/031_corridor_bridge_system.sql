-- Migration 031: Corridor Bridge System
-- Enables sAED-to-AED bridging via Liquidity Providers (LPs)
-- Trader B pays with sAED, LP (Trader C) sends real AED to seller (Trader A)

-- 1. corridor_providers — LP registration table
CREATE TABLE IF NOT EXISTS corridor_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),

  is_active BOOLEAN NOT NULL DEFAULT false,
  fee_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0.50 CHECK (fee_percentage >= 0 AND fee_percentage <= 10),
  min_amount DECIMAL(20, 6) NOT NULL DEFAULT 100 CHECK (min_amount > 0),
  max_amount DECIMAL(20, 6) NOT NULL DEFAULT 50000 CHECK (max_amount > 0),

  auto_accept BOOLEAN NOT NULL DEFAULT true,
  available_hours_start TIME,
  available_hours_end TIME,

  total_fulfillments INTEGER NOT NULL DEFAULT 0,
  total_volume DECIMAL(20, 6) NOT NULL DEFAULT 0,
  avg_fulfillment_time_sec INTEGER,
  last_fulfillment_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(merchant_id)
);

-- 2. corridor_fulfillments — links main order to LP fulfillment
CREATE TABLE IF NOT EXISTS corridor_fulfillments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id UUID NOT NULL REFERENCES orders(id),
  provider_merchant_id UUID NOT NULL REFERENCES merchants(id),
  provider_id UUID NOT NULL REFERENCES corridor_providers(id),

  -- Buyer's locked sAED (fils, 100 fils = 1 AED)
  saed_amount_locked BIGINT NOT NULL CHECK (saed_amount_locked > 0),
  -- Fiat amount LP must send to seller's bank (AED)
  fiat_amount DECIMAL(20, 6) NOT NULL CHECK (fiat_amount > 0),
  -- LP fee in fils
  corridor_fee BIGINT NOT NULL DEFAULT 0 CHECK (corridor_fee >= 0),

  -- LP lifecycle: pending → payment_sent → completed | failed | cancelled
  provider_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (
    provider_status IN ('pending', 'payment_sent', 'completed', 'failed', 'cancelled')
  ),

  -- Seller's bank info snapshot for LP reference
  bank_details JSONB,

  -- LP must send within this deadline
  send_deadline TIMESTAMPTZ NOT NULL,

  idempotency_key VARCHAR(255) UNIQUE,

  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payment_sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Add columns to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_via VARCHAR(20) DEFAULT 'bank' CHECK (
    payment_via IN ('bank', 'saed_corridor')
  ),
  ADD COLUMN IF NOT EXISTS corridor_fulfillment_id UUID REFERENCES corridor_fulfillments(id);

-- 4. Update ledger_entries constraint to include corridor types
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ledger_entries_entry_type_check'
    AND conrelid = 'ledger_entries'::regclass
  ) THEN
    ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_entry_type_check;
  END IF;

  ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (
    entry_type IN (
      'DEPOSIT', 'WITHDRAWAL',
      'ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_REFUND',
      'FEE', 'FEE_EARNING',
      'ADJUSTMENT', 'ORDER_PAYMENT', 'ORDER_RECEIPT',
      'SYNTHETIC_CONVERSION',
      'CORRIDOR_SAED_LOCK', 'CORRIDOR_SAED_TRANSFER', 'CORRIDOR_FEE'
    )
  );
END $$;

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_corridor_providers_active
  ON corridor_providers(is_active, merchant_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_corridor_fulfillments_order
  ON corridor_fulfillments(order_id);

CREATE INDEX IF NOT EXISTS idx_corridor_fulfillments_provider
  ON corridor_fulfillments(provider_merchant_id, provider_status);

CREATE INDEX IF NOT EXISTS idx_corridor_fulfillments_deadline
  ON corridor_fulfillments(send_deadline) WHERE provider_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_orders_payment_via_corridor
  ON orders(payment_via) WHERE payment_via = 'saed_corridor';

COMMENT ON TABLE corridor_providers IS 'Merchant LP registrations for sAED-to-AED bridging';
COMMENT ON TABLE corridor_fulfillments IS 'Tracks LP fulfillment for corridor-bridged orders';
COMMENT ON COLUMN orders.payment_via IS 'How buyer pays: bank (direct) or saed_corridor (LP bridge)';
COMMENT ON COLUMN corridor_fulfillments.saed_amount_locked IS 'Buyer sAED locked in fils (100 fils = 1 AED)';
