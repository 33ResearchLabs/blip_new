-- Blip.money Database Schema
-- PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================
-- ENUMS
-- =====================

CREATE TYPE kyc_status AS ENUM ('none', 'pending', 'verified', 'rejected');
CREATE TYPE merchant_status AS ENUM ('pending', 'active', 'suspended', 'banned');
CREATE TYPE offer_type AS ENUM ('buy', 'sell');
CREATE TYPE payment_method AS ENUM ('bank', 'cash');
CREATE TYPE rate_type AS ENUM ('fixed', 'market_margin');
CREATE TYPE order_status AS ENUM (
  'pending',
  'accepted',
  'escrow_pending',
  'escrowed',
  'payment_pending',
  'payment_sent',
  'payment_confirmed',
  'releasing',
  'completed',
  'cancelled',
  'disputed',
  'expired'
);
CREATE TYPE actor_type AS ENUM ('user', 'merchant', 'system');
CREATE TYPE message_type AS ENUM ('text', 'image', 'system');
CREATE TYPE dispute_reason AS ENUM (
  'payment_not_received',
  'crypto_not_received',
  'wrong_amount',
  'fraud',
  'other'
);
CREATE TYPE dispute_status AS ENUM ('open', 'investigating', 'resolved', 'escalated');

-- =====================
-- TABLES
-- =====================

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  wallet_address VARCHAR(64) UNIQUE,
  phone VARCHAR(20),
  avatar_url TEXT,

  -- KYC
  kyc_status kyc_status DEFAULT 'none',
  kyc_level INT DEFAULT 0,

  -- Stats
  total_trades INT DEFAULT 0,
  total_volume DECIMAL(20, 2) DEFAULT 0,
  rating DECIMAL(2, 1) DEFAULT 5.0,

  -- Settings
  push_token TEXT,
  notification_settings JSONB DEFAULT '{}',

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Merchants
CREATE TABLE merchants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address VARCHAR(64) UNIQUE NOT NULL,
  business_name VARCHAR(100) NOT NULL,
  display_name VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  avatar_url TEXT,

  -- Verification
  status merchant_status DEFAULT 'pending',
  verification_level INT DEFAULT 1,

  -- Stats
  total_trades INT DEFAULT 0,
  total_volume DECIMAL(20, 2) DEFAULT 0,
  rating DECIMAL(2, 1) DEFAULT 5.0,
  rating_count INT DEFAULT 0,
  avg_response_time_mins INT DEFAULT 5,

  -- Availability
  is_online BOOLEAN DEFAULT false,
  last_seen_at TIMESTAMP,
  auto_accept_enabled BOOLEAN DEFAULT false,
  auto_accept_max_amount DECIMAL(20, 2),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Merchant Offers
CREATE TABLE merchant_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,

  -- Offer Type
  type offer_type NOT NULL,
  payment_method payment_method NOT NULL,

  -- Pricing
  rate DECIMAL(10, 4) NOT NULL,
  rate_type rate_type DEFAULT 'fixed',
  margin_percent DECIMAL(5, 2),

  -- Limits
  min_amount DECIMAL(20, 2) NOT NULL,
  max_amount DECIMAL(20, 2) NOT NULL,
  available_amount DECIMAL(20, 2) NOT NULL,

  -- Bank Details (if bank transfer)
  bank_name VARCHAR(100),
  bank_account_name VARCHAR(100),
  bank_iban VARCHAR(34),

  -- Cash Details (if cash)
  location_name VARCHAR(100),
  location_address TEXT,
  location_lat DECIMAL(10, 7),
  location_lng DECIMAL(10, 7),
  meeting_instructions TEXT,

  -- Settings
  is_active BOOLEAN DEFAULT true,
  requires_kyc_level INT DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_offers_active ON merchant_offers(is_active, type, payment_method);
CREATE INDEX idx_offers_merchant ON merchant_offers(merchant_id);

-- Orders
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number VARCHAR(20) UNIQUE NOT NULL,

  -- Parties
  user_id UUID REFERENCES users(id),
  merchant_id UUID REFERENCES merchants(id),
  offer_id UUID REFERENCES merchant_offers(id),

  -- Order Type
  type offer_type NOT NULL,
  payment_method payment_method NOT NULL,

  -- Amounts
  crypto_amount DECIMAL(20, 6) NOT NULL,
  crypto_currency VARCHAR(10) DEFAULT 'USDC',
  fiat_amount DECIMAL(20, 2) NOT NULL,
  fiat_currency VARCHAR(10) DEFAULT 'AED',
  rate DECIMAL(10, 4) NOT NULL,

  -- Fees
  platform_fee DECIMAL(20, 6) DEFAULT 0,
  network_fee DECIMAL(20, 6) DEFAULT 0,

  -- Status
  status order_status DEFAULT 'pending',

  -- Escrow (on-chain references)
  escrow_tx_hash VARCHAR(128),
  escrow_address VARCHAR(64),
  escrow_trade_id BIGINT,              -- On-chain trade ID for release
  escrow_trade_pda VARCHAR(64),        -- Trade PDA address
  escrow_pda VARCHAR(64),              -- Escrow vault PDA address
  escrow_creator_wallet VARCHAR(64),   -- Wallet that created the escrow (user)
  release_tx_hash VARCHAR(128),        -- TX hash when escrow released to recipient
  refund_tx_hash VARCHAR(128),         -- TX hash when escrow refunded to creator (dispute)

  -- Payment Details (snapshot at order time)
  payment_details JSONB,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  accepted_at TIMESTAMP,
  escrowed_at TIMESTAMP,
  payment_sent_at TIMESTAMP,
  payment_confirmed_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  expires_at TIMESTAMP,

  -- Cancellation
  cancelled_by actor_type,
  cancellation_reason TEXT
);

CREATE INDEX idx_orders_user ON orders(user_id, status);
CREATE INDEX idx_orders_merchant ON orders(merchant_id, status);
CREATE INDEX idx_orders_status ON orders(status, created_at);

-- Order Events (Audit Log)
CREATE TABLE order_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,

  event_type VARCHAR(50) NOT NULL,
  actor_type actor_type NOT NULL,
  actor_id UUID,

  old_status order_status,
  new_status order_status,

  metadata JSONB,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_events_order ON order_events(order_id, created_at);

-- Chat Messages
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,

  sender_type actor_type NOT NULL,
  sender_id UUID,

  message_type message_type DEFAULT 'text',
  content TEXT NOT NULL,
  image_url TEXT,

  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_order ON chat_messages(order_id, created_at);

-- User Bank Accounts
CREATE TABLE user_bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,

  bank_name VARCHAR(100) NOT NULL,
  account_name VARCHAR(100) NOT NULL,
  iban VARCHAR(34) NOT NULL,

  is_default BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bank_accounts_user ON user_bank_accounts(user_id);

-- Reviews
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) UNIQUE,

  reviewer_type actor_type NOT NULL,
  reviewer_id UUID NOT NULL,
  reviewee_type actor_type NOT NULL,
  reviewee_id UUID NOT NULL,

  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Disputes
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id),

  raised_by actor_type NOT NULL,
  raiser_id UUID NOT NULL,

  reason dispute_reason NOT NULL,
  description TEXT,
  evidence_urls TEXT[],

  status dispute_status DEFAULT 'open',
  resolution TEXT,
  resolved_in_favor_of actor_type,

  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- =====================
-- FUNCTIONS
-- =====================

-- Generate order number
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.order_number := 'BM-' || TO_CHAR(NOW(), 'YYMMDD') || '-' || UPPER(SUBSTR(NEW.id::TEXT, 1, 4));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION generate_order_number();

-- Update timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_merchants_updated_at
  BEFORE UPDATE ON merchants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_offers_updated_at
  BEFORE UPDATE ON merchant_offers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =====================
-- SEED DATA
-- =====================

-- Insert test merchants
INSERT INTO merchants (wallet_address, business_name, display_name, email, status, is_online, rating, total_trades, avg_response_time_mins) VALUES
('0xMerchant1Address123456789', 'Quick Exchange LLC', 'QuickSwap', 'merchant1@blip.money', 'active', true, 4.9, 847, 3),
('0xMerchant2Address987654321', 'Desert Gold Trading', 'DesertGold', 'merchant2@blip.money', 'active', true, 4.7, 523, 8),
('0xMerchant3CashDealer000001', 'Dubai Cash Exchange', 'CashKing', 'merchant3@blip.money', 'active', true, 4.8, 312, 5);

-- Insert test offers (bank transfers)
INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, bank_name, bank_account_name, bank_iban) VALUES
((SELECT id FROM merchants WHERE display_name = 'QuickSwap'), 'sell', 'bank', 3.67, 100, 50000, 25000, 'Emirates NBD', 'Quick Exchange LLC', 'AE070331234567890123456'),
((SELECT id FROM merchants WHERE display_name = 'DesertGold'), 'sell', 'bank', 3.68, 500, 100000, 75000, 'ADCB', 'Desert Gold Trading', 'AE500560001234567890123');

-- Insert test offers (cash)
INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, location_name, location_address, location_lat, location_lng, meeting_instructions) VALUES
((SELECT id FROM merchants WHERE display_name = 'CashKing'), 'sell', 'cash', 3.65, 500, 20000, 15000, 'Dubai Mall', 'Financial Center Road, Downtown Dubai', 25.1972, 55.2744, 'Meet at Starbucks near Apple Store, Ground Floor. I will be wearing a blue cap.');

-- Insert test user
INSERT INTO users (wallet_address, name, email, kyc_status, kyc_level) VALUES
('0xUserWallet123456789abcdef', 'Demo User', 'demo@blip.money', 'verified', 1);

-- Insert test bank account for user
INSERT INTO user_bank_accounts (user_id, bank_name, account_name, iban, is_default, is_verified) VALUES
((SELECT id FROM users WHERE name = 'Demo User'), 'Emirates NBD', 'Demo User', 'AE12 0345 0000 0012 3456 789', true, true);
