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

-- Migration 014: Direct Messaging System
-- ============================================================================
-- Merchant contacts (supports both user and merchant contacts)
CREATE TABLE IF NOT EXISTS merchant_contacts (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  merchant_id VARCHAR(36) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
  contact_merchant_id VARCHAR(36) REFERENCES merchants(id) ON DELETE CASCADE,
  contact_type VARCHAR(20) DEFAULT 'user',
  nickname VARCHAR(100),
  notes TEXT,
  is_favorite BOOLEAN DEFAULT FALSE,
  trades_count INT DEFAULT 0,
  total_volume DECIMAL(20, 2) DEFAULT 0,
  last_trade_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(merchant_id, user_id),
  CHECK (
    (contact_type = 'user' AND user_id IS NOT NULL AND contact_merchant_id IS NULL) OR
    (contact_type = 'merchant' AND contact_merchant_id IS NOT NULL AND user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_merchant_contacts_merchant ON merchant_contacts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_contacts_user ON merchant_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_merchant_contacts_contact_merchant ON merchant_contacts(contact_merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_contacts_favorites ON merchant_contacts(merchant_id, is_favorite);

-- Add unique index for merchant-to-merchant contacts
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_contacts_m2m
  ON merchant_contacts(merchant_id, contact_merchant_id)
  WHERE contact_merchant_id IS NOT NULL;

-- Direct messages (not tied to orders)
CREATE TABLE IF NOT EXISTS direct_messages (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('merchant', 'user')),
  sender_id VARCHAR(36) NOT NULL,
  recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('merchant', 'user')),
  recipient_id VARCHAR(36) NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image')),
  image_url TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fetching conversation between two parties
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation ON direct_messages(
  LEAST(sender_id, recipient_id),
  GREATEST(sender_id, recipient_id),
  created_at DESC
);

-- Index for fetching messages for a specific user/merchant
CREATE INDEX IF NOT EXISTS idx_direct_messages_sender ON direct_messages(sender_id, sender_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient ON direct_messages(recipient_id, recipient_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_unread ON direct_messages(recipient_id, recipient_type, is_read) WHERE is_read = false;

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

-- Migration 020: Ratings System
-- ============================================================================
-- Ratings table to store individual ratings
CREATE TABLE IF NOT EXISTS ratings (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  order_id VARCHAR(36) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rater_type VARCHAR(20) NOT NULL CHECK (rater_type IN ('merchant', 'user')),
  rater_id VARCHAR(36) NOT NULL,
  rated_type VARCHAR(20) NOT NULL CHECK (rated_type IN ('merchant', 'user')),
  rated_id VARCHAR(36) NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, rater_type, rater_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_order ON ratings(order_id);
CREATE INDEX IF NOT EXISTS idx_ratings_rated ON ratings(rated_type, rated_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_rater ON ratings(rater_type, rater_id, created_at DESC);

-- Add rating tracking columns to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS merchant_rated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_rated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merchant_rating INTEGER CHECK (merchant_rating >= 1 AND merchant_rating <= 5),
  ADD COLUMN IF NOT EXISTS user_rating INTEGER CHECK (user_rating >= 1 AND user_rating <= 5);

-- Add aggregate rating columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_rating_sum INTEGER DEFAULT 0;

-- Update users.rating to be calculated (if not already)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'rating' AND data_type = 'numeric') THEN
    -- Already exists, do nothing
  ELSE
    ALTER TABLE users ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2) DEFAULT 0;
  END IF;
END $$;

-- Add aggregate rating columns to merchants table (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchants' AND column_name = 'rating_count') THEN
    ALTER TABLE merchants ADD COLUMN rating_count INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchants' AND column_name = 'total_rating_sum') THEN
    ALTER TABLE merchants ADD COLUMN total_rating_sum INTEGER DEFAULT 0;
  END IF;
END $$;

-- Function to update aggregate ratings when a new rating is added
CREATE OR REPLACE FUNCTION update_aggregate_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rated_type = 'user' THEN
    UPDATE users
    SET
      total_rating_sum = COALESCE(total_rating_sum, 0) + NEW.rating,
      rating_count = COALESCE(rating_count, 0) + 1,
      rating = ROUND((COALESCE(total_rating_sum, 0) + NEW.rating)::DECIMAL / (COALESCE(rating_count, 0) + 1), 2)
    WHERE id = NEW.rated_id;
  END IF;

  IF NEW.rated_type = 'merchant' THEN
    UPDATE merchants
    SET
      total_rating_sum = COALESCE(total_rating_sum, 0) + NEW.rating,
      rating_count = COALESCE(rating_count, 0) + 1,
      rating = ROUND((COALESCE(total_rating_sum, 0) + NEW.rating)::DECIMAL / (COALESCE(rating_count, 0) + 1), 2)
    WHERE id = NEW.rated_id;
  END IF;

  IF NEW.rater_type = 'merchant' THEN
    UPDATE orders SET merchant_rating = NEW.rating, merchant_rated_at = NEW.created_at WHERE id = NEW.order_id;
  ELSIF NEW.rater_type = 'user' THEN
    UPDATE orders SET user_rating = NEW.rating, user_rated_at = NEW.created_at WHERE id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_aggregate_rating ON ratings;
CREATE TRIGGER trigger_update_aggregate_rating
  AFTER INSERT ON ratings
  FOR EACH ROW
  EXECUTE FUNCTION update_aggregate_rating();

-- View for top rated sellers (merchants)
CREATE OR REPLACE VIEW v_top_rated_sellers AS
SELECT
  m.id,
  m.username,
  m.display_name,
  m.rating,
  m.rating_count,
  m.total_trades,
  m.wallet_address,
  m.created_at,
  RANK() OVER (ORDER BY m.rating DESC, m.rating_count DESC) as rank
FROM merchants m
WHERE m.status = 'active'
  AND m.rating_count >= 3
ORDER BY m.rating DESC, m.rating_count DESC
LIMIT 10;

-- View for top rated users
CREATE OR REPLACE VIEW v_top_rated_users AS
SELECT
  u.id,
  u.username,
  u.rating,
  u.rating_count,
  u.total_trades,
  u.wallet_address,
  u.created_at,
  RANK() OVER (ORDER BY u.rating DESC, u.rating_count DESC) as rank
FROM users u
WHERE u.rating_count >= 3
ORDER BY u.rating DESC, u.rating_count DESC
LIMIT 10;

-- ============================================================================
-- Migration 021: AED Mempool + Gas Pricing System
-- ============================================================================
-- Implements ETH-like mempool with priority fees for USDT→AED corridor

-- Corridor prices (reference prices for each trading pair)
CREATE TABLE IF NOT EXISTS corridor_prices (
  corridor_id VARCHAR(20) PRIMARY KEY,
  ref_price DECIMAL(20, 8) NOT NULL,
  volume_5m DECIMAL(20, 2) DEFAULT 0,
  avg_fill_time_sec INTEGER DEFAULT 0,
  active_merchants_count INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Initial seed for USDT→AED
INSERT INTO corridor_prices (corridor_id, ref_price)
VALUES ('USDT_AED', 3.67)
ON CONFLICT (corridor_id) DO NOTHING;

-- Add mempool/gas fields to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS corridor_id VARCHAR(20) DEFAULT 'USDT_AED',
  ADD COLUMN IF NOT EXISTS side VARCHAR(10) DEFAULT 'BUY',
  ADD COLUMN IF NOT EXISTS ref_price_at_create DECIMAL(20, 8),
  ADD COLUMN IF NOT EXISTS premium_bps_current INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_bps_cap INTEGER DEFAULT 500,
  ADD COLUMN IF NOT EXISTS bump_step_bps INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS bump_interval_sec INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS auto_bump_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS winner_merchant_id VARCHAR(36),
  ADD COLUMN IF NOT EXISTS next_bump_at TIMESTAMP;

-- Add foreign key for winner_merchant_id if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'orders_winner_merchant_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_winner_merchant_id_fkey
      FOREIGN KEY (winner_merchant_id) REFERENCES merchants(id);
  END IF;
END $$;

-- Merchant quotes (pricing preferences per corridor)
CREATE TABLE IF NOT EXISTS merchant_quotes (
  id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  merchant_id VARCHAR(36) NOT NULL,
  corridor_id VARCHAR(20) NOT NULL DEFAULT 'USDT_AED',
  min_price_aed_per_usdt DECIMAL(20, 8) NOT NULL,
  min_size_usdt DECIMAL(20, 2) DEFAULT 10,
  max_size_usdt DECIMAL(20, 2) DEFAULT 10000,
  sla_minutes INTEGER DEFAULT 15,
  available_liquidity_usdt DECIMAL(20, 2) DEFAULT 0,
  is_online BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(merchant_id, corridor_id)
);

-- Add foreign key for merchant_id if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'merchant_quotes_merchant_id_fkey'
  ) THEN
    ALTER TABLE merchant_quotes
      ADD CONSTRAINT merchant_quotes_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_merchant_quotes_online ON merchant_quotes(corridor_id, is_online) WHERE is_online = TRUE;
CREATE INDEX IF NOT EXISTS idx_merchant_quotes_merchant ON merchant_quotes(merchant_id);

-- Order events (audit log)
CREATE TABLE IF NOT EXISTS order_events (
  id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
  order_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add foreign key for order_id if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'order_events_order_id_fkey'
  ) THEN
    ALTER TABLE order_events
      ADD CONSTRAINT order_events_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_events_type ON order_events(event_type, created_at DESC);

-- Indexes for mempool queries
CREATE INDEX IF NOT EXISTS idx_orders_mempool ON orders(corridor_id, status, expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_orders_corridor_status ON orders(corridor_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_next_bump ON orders(next_bump_at)
  WHERE auto_bump_enabled = TRUE AND status = 'pending';

-- Function to calculate current offer price
CREATE OR REPLACE FUNCTION calculate_offer_price(
  p_ref_price DECIMAL,
  p_premium_bps INTEGER
) RETURNS DECIMAL AS $$
BEGIN
  RETURN ROUND(p_ref_price * (1 + p_premium_bps::DECIMAL / 10000), 8);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if order is mineable for a merchant
CREATE OR REPLACE FUNCTION is_order_mineable(
  p_order_id VARCHAR,
  p_merchant_id VARCHAR
) RETURNS BOOLEAN AS $$
DECLARE
  v_mineable BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM orders o
    JOIN merchant_quotes mq ON mq.corridor_id = o.corridor_id AND mq.merchant_id = p_merchant_id
    WHERE o.id = p_order_id
      AND o.status = 'pending'
      AND NOW() < o.expires_at
      AND mq.is_online = TRUE
      AND o.crypto_amount >= mq.min_size_usdt
      AND o.crypto_amount <= mq.max_size_usdt
      AND mq.available_liquidity_usdt >= o.crypto_amount
      AND calculate_offer_price(o.ref_price_at_create, o.premium_bps_current) >= mq.min_price_aed_per_usdt
  ) INTO v_mineable;

  RETURN v_mineable;
END;
$$ LANGUAGE plpgsql;

-- View for mempool orders with computed fields
CREATE OR REPLACE VIEW v_mempool_orders AS
SELECT
  o.id,
  o.order_number,
  o.corridor_id,
  o.side,
  o.crypto_amount as amount_usdt,
  o.ref_price_at_create,
  o.premium_bps_current,
  o.premium_bps_cap,
  o.bump_step_bps,
  o.auto_bump_enabled,
  o.next_bump_at,
  calculate_offer_price(o.ref_price_at_create, o.premium_bps_current) as current_offer_price,
  calculate_offer_price(o.ref_price_at_create, o.premium_bps_cap) as max_offer_price,
  o.expires_at,
  EXTRACT(EPOCH FROM (o.expires_at - NOW()))::INTEGER as seconds_until_expiry,
  o.user_id,
  o.merchant_id as creator_merchant_id,
  u.username as creator_username,
  o.created_at,
  o.status
FROM orders o
LEFT JOIN users u ON o.user_id = u.id
WHERE o.status = 'pending'
  AND NOW() < o.expires_at
ORDER BY o.premium_bps_current DESC, o.created_at ASC;

-- ============================================================================
-- Verification Query
-- ============================================================================
-- Run this to verify all columns exist:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'orders' AND column_name IN ('spread_preference', 'protocol_fee_percentage', 'protocol_fee_amount', 'merchant_spread_percentage', 'is_auto_cancelled', 'escrow_trade_id', 'corridor_id', 'premium_bps_current');
