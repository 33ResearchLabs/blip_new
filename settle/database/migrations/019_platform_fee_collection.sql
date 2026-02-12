-- Migration 019: Platform Fee Collection
-- Adds tables to track protocol fees collected by the platform admin

-- Single-row table for platform balance (accumulated fees)
CREATE TABLE IF NOT EXISTS platform_balance (
  id SERIAL PRIMARY KEY,
  key VARCHAR(50) UNIQUE NOT NULL DEFAULT 'main',
  balance DECIMAL(20, 8) NOT NULL DEFAULT 0,
  total_fees_collected DECIMAL(20, 8) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed the single row
INSERT INTO platform_balance (key, balance, total_fees_collected)
VALUES ('main', 0, 0)
ON CONFLICT (key) DO NOTHING;

-- Audit log for each fee collected on order completion
CREATE TABLE IF NOT EXISTS platform_fee_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  fee_amount DECIMAL(20, 8) NOT NULL,
  fee_percentage DECIMAL(5, 2) NOT NULL,
  spread_preference VARCHAR(20),
  platform_balance_after DECIMAL(20, 8) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_fee_tx_order ON platform_fee_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_platform_fee_tx_created ON platform_fee_transactions(created_at DESC);
