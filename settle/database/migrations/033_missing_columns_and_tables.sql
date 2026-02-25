-- Migration 033: Add missing columns and tables referenced by code
-- Fixes runtime SQL errors for merchant_transactions, user columns, and disputes

-- 1. Create merchant_transactions table (used by escrow, fees, conversions)
CREATE TABLE IF NOT EXISTS merchant_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID REFERENCES merchants(id),
  user_id         UUID REFERENCES users(id),
  order_id        UUID REFERENCES orders(id),
  type            VARCHAR NOT NULL,
  amount          NUMERIC NOT NULL,
  balance_before  NUMERIC NOT NULL,
  balance_after   NUMERIC NOT NULL,
  description     TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_merchant_transactions_merchant ON merchant_transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_transactions_order ON merchant_transactions(order_id);

-- 2. Add missing columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance NUMERIC(20,6) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS sinr_balance BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_rating_sum INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS synthetic_rate NUMERIC NOT NULL DEFAULT 3.67;
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_sinr_exposure BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reputation_score INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 2b. Add missing columns to merchants table
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS sinr_balance BIGINT DEFAULT 0;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS max_sinr_exposure BIGINT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS synthetic_rate DECIMAL(10,4) DEFAULT 3.6700;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS total_rating_sum INTEGER DEFAULT 0;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS big_order_threshold DECIMAL(20,2) DEFAULT 10000;
CREATE INDEX IF NOT EXISTS idx_merchants_username ON merchants(username);

-- 2c. Add missing columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_creator_wallet VARCHAR(64);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_trade_pda VARCHAR(64);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_pda VARCHAR(64);

-- 3. Add missing column to disputes table
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolved_by TEXT;
