-- ============================================================================
-- Railway Database Migration - Complete Schema Update
-- ============================================================================
-- This script applies all migrations from 017 onwards
-- Run this on Railway PostgreSQL to fix missing columns
-- ============================================================================

-- Migration 017: Spread preference and protocol fee system
-- ============================================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS spread_preference VARCHAR(20) DEFAULT 'fastest',
  ADD COLUMN IF NOT EXISTS protocol_fee_percentage DECIMAL(5,2) DEFAULT 2.50,
  ADD COLUMN IF NOT EXISTS protocol_fee_amount DECIMAL(20,8),
  ADD COLUMN IF NOT EXISTS merchant_spread_percentage DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS is_auto_cancelled BOOLEAN DEFAULT FALSE;

-- Drop existing constraint if it exists (idempotent)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS check_spread_preference;

-- Add check constraint for spread preference values
ALTER TABLE orders
  ADD CONSTRAINT check_spread_preference
  CHECK (spread_preference IN ('best', 'fastest', 'cheap'));

-- Add indices for matching engine (IF NOT EXISTS for idempotency)
CREATE INDEX IF NOT EXISTS idx_orders_matching
  ON orders(status, type, payment_method, spread_preference, created_at);

CREATE INDEX IF NOT EXISTS idx_orders_spread_ranking
  ON orders(spread_preference, created_at)
  WHERE status = 'pending';

-- Note: View creation moved after escrow_trade_id column type change (see below)

-- Create function to calculate protocol fee
CREATE OR REPLACE FUNCTION calculate_protocol_fee(
  p_crypto_amount DECIMAL,
  p_spread_preference VARCHAR
) RETURNS TABLE (
  fee_percentage DECIMAL,
  fee_amount DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN p_spread_preference = 'best' THEN 2.00
      WHEN p_spread_preference = 'fastest' THEN 2.50
      WHEN p_spread_preference = 'cheap' THEN 1.50
      ELSE 2.50
    END::DECIMAL(5,2) as fee_percentage,
    (p_crypto_amount *
      CASE
        WHEN p_spread_preference = 'best' THEN 0.02
        WHEN p_spread_preference = 'fastest' THEN 0.025
        WHEN p_spread_preference = 'cheap' THEN 0.015
        ELSE 0.025
      END
    )::DECIMAL(20,8) as fee_amount;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create function to get matching orders
CREATE OR REPLACE FUNCTION get_matching_orders(
  p_order_type VARCHAR,
  p_payment_method VARCHAR,
  p_crypto_amount DECIMAL,
  p_exclude_merchant_id VARCHAR,
  p_limit INTEGER DEFAULT 10
) RETURNS TABLE (
  order_id VARCHAR,
  merchant_id VARCHAR,
  merchant_name VARCHAR,
  merchant_rating DECIMAL,
  merchant_total_trades INTEGER,
  merchant_wallet VARCHAR,
  crypto_amount DECIMAL,
  rate DECIMAL,
  spread_preference VARCHAR,
  match_priority_score INTEGER,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.id,
    v.merchant_id,
    v.merchant_name,
    v.merchant_rating,
    v.merchant_total_trades,
    v.merchant_wallet,
    v.crypto_amount,
    v.rate,
    v.spread_preference,
    v.match_priority_score,
    v.created_at
  FROM v_order_book v
  WHERE v.type = (CASE WHEN p_order_type = 'buy' THEN 'sell' ELSE 'buy' END)
    AND v.payment_method = p_payment_method
    AND v.crypto_amount >= p_crypto_amount * 0.9
    AND v.crypto_amount <= p_crypto_amount * 1.1
    AND v.merchant_id != p_exclude_merchant_id
    AND v.status IN ('pending', 'escrowed')
  ORDER BY v.match_priority_score DESC, v.created_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Backfill existing orders
UPDATE orders
SET
  spread_preference = 'fastest',
  protocol_fee_percentage = 2.50
WHERE spread_preference IS NULL;

-- Migration 018: Fix escrow_trade_id to BIGINT
-- ============================================================================
-- Drop view first (it depends on orders table structure)
DROP VIEW IF EXISTS v_order_book CASCADE;

ALTER TABLE orders
  ALTER COLUMN escrow_trade_id TYPE BIGINT USING escrow_trade_id::BIGINT;

-- Recreate view for order book with spread priority (after column type change)
CREATE OR REPLACE VIEW v_order_book AS
SELECT
  o.*,
  m.display_name as merchant_name,
  m.rating as merchant_rating,
  m.total_trades as merchant_total_trades,
  m.avg_response_time_mins as merchant_response_time,
  m.wallet_address as merchant_wallet,
  CASE
    WHEN o.spread_preference = 'best' THEN 100
    WHEN o.spread_preference = 'fastest' THEN 75
    WHEN o.spread_preference = 'cheap' THEN 50
    ELSE 0
  END +
  (m.rating * 10) +
  (CASE WHEN m.avg_response_time_mins < 5 THEN 20 ELSE 0 END) as match_priority_score
FROM orders o
JOIN merchants m ON o.merchant_id = m.id
WHERE o.status IN ('pending', 'escrowed')
ORDER BY match_priority_score DESC, o.created_at ASC;

-- Migration 019: M2M Contacts
-- ============================================================================
CREATE TABLE IF NOT EXISTS merchant_contacts (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  merchant_id VARCHAR(36) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  contact_merchant_id VARCHAR(36) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  display_name VARCHAR(255),
  notes TEXT,
  is_favorite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(merchant_id, contact_merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_contacts_merchant ON merchant_contacts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_contacts_favorites ON merchant_contacts(merchant_id, is_favorite);

-- Migration 019: Platform Fee Collection
-- ============================================================================
CREATE TABLE IF NOT EXISTS platform_balance (
  key VARCHAR(50) PRIMARY KEY DEFAULT 'main',
  balance DECIMAL(20,6) DEFAULT 0 NOT NULL,
  total_fees_collected DECIMAL(20,6) DEFAULT 0 NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_fee_transactions (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  order_id VARCHAR(36) NOT NULL,
  fee_amount DECIMAL(20,6) NOT NULL,
  fee_percentage DECIMAL(5,2) NOT NULL,
  spread_preference VARCHAR(20),
  platform_balance_after DECIMAL(20,6) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_fee_transactions_order_id_fkey'
  ) THEN
    ALTER TABLE platform_fee_transactions
    ADD CONSTRAINT platform_fee_transactions_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_platform_fee_transactions_order ON platform_fee_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_platform_fee_transactions_created ON platform_fee_transactions(created_at DESC);

-- Initialize platform balance
INSERT INTO platform_balance (key, balance, total_fees_collected)
VALUES ('main', 0, 0)
ON CONFLICT (key) DO NOTHING;

-- Migration: Merchant Transactions Table (if not exists)
-- ============================================================================
CREATE TABLE IF NOT EXISTS merchant_transactions (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  merchant_id VARCHAR(36) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  order_id VARCHAR(36) REFERENCES orders(id),
  type VARCHAR(50) NOT NULL,
  amount DECIMAL(20,6) NOT NULL,
  balance_before DECIMAL(20,6) NOT NULL,
  balance_after DECIMAL(20,6) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchant_transactions_merchant ON merchant_transactions(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_merchant_transactions_order ON merchant_transactions(order_id);

-- ============================================================================
-- Verification Query
-- ============================================================================
-- Run this to verify all columns exist:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'orders' AND column_name IN ('spread_preference', 'protocol_fee_percentage', 'protocol_fee_amount', 'merchant_spread_percentage', 'is_auto_cancelled', 'escrow_trade_id');
