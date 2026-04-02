-- BlipScan Database Schema
-- Minimal P2P Trade Explorer for Solana Escrow

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TRADES TABLE
-- Core table storing all P2P trades
-- ============================================
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- On-chain identifiers
  escrow_address TEXT NOT NULL UNIQUE,
  deal_id TEXT NOT NULL,
  signature TEXT NOT NULL, -- creation signature

  -- Parties
  merchant_pubkey TEXT NOT NULL,
  buyer_pubkey TEXT,
  arbiter_pubkey TEXT NOT NULL,
  treasury_pubkey TEXT NOT NULL,

  -- Token info
  mint_address TEXT NOT NULL,
  amount BIGINT NOT NULL,
  fee_bps INTEGER NOT NULL,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'funded', -- funded, locked, released, refunded

  -- Timestamps (using slots for accuracy)
  created_slot BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  locked_slot BIGINT,
  locked_at TIMESTAMP,
  released_slot BIGINT,
  released_at TIMESTAMP,

  -- Metadata
  region_code TEXT, -- extracted from MongoDB order
  payment_method TEXT, -- extracted from MongoDB order
  order_id TEXT, -- link to MongoDB order if exists

  -- Indexes
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TRADE EVENTS TABLE
-- Full audit log of all state transitions
-- ============================================
CREATE TABLE trade_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  trade_id UUID REFERENCES trades(id) ON DELETE CASCADE,
  escrow_address TEXT NOT NULL,

  -- Event details
  event_type TEXT NOT NULL, -- created, locked, released, refunded
  signature TEXT NOT NULL,
  slot BIGINT NOT NULL,
  block_time TIMESTAMP NOT NULL,

  -- Actor
  signer TEXT NOT NULL,

  -- Raw data
  instruction_data JSONB,
  logs TEXT[],

  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- MERCHANT STATS TABLE
-- Reputation and performance metrics
-- ============================================
CREATE TABLE merchant_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  merchant_pubkey TEXT NOT NULL UNIQUE,

  -- Volume metrics
  total_trades INTEGER DEFAULT 0,
  total_volume BIGINT DEFAULT 0,
  completed_trades INTEGER DEFAULT 0,
  cancelled_trades INTEGER DEFAULT 0,

  -- Performance metrics
  avg_completion_time_seconds INTEGER,
  median_completion_time_seconds INTEGER,
  fastest_completion_seconds INTEGER,

  -- Reputation
  completion_rate DECIMAL(5,2), -- percentage
  reputation_score DECIMAL(5,2), -- 0-100 score

  -- Time windows
  last_trade_at TIMESTAMP,
  first_trade_at TIMESTAMP,

  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- INDEXER CURSOR TABLE
-- Track indexer progress
-- ============================================
CREATE TABLE indexer_cursor (
  id SERIAL PRIMARY KEY,
  program_id TEXT NOT NULL,
  last_processed_signature TEXT,
  last_processed_slot BIGINT,
  last_indexed_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Trades
CREATE INDEX idx_trades_merchant ON trades(merchant_pubkey);
CREATE INDEX idx_trades_buyer ON trades(buyer_pubkey);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX idx_trades_escrow ON trades(escrow_address);
CREATE INDEX idx_trades_order_id ON trades(order_id) WHERE order_id IS NOT NULL;

-- Events
CREATE INDEX idx_events_trade_id ON trade_events(trade_id);
CREATE INDEX idx_events_signature ON trade_events(signature);
CREATE INDEX idx_events_slot ON trade_events(slot DESC);
CREATE INDEX idx_events_escrow ON trade_events(escrow_address);
CREATE INDEX idx_events_type ON trade_events(event_type);

-- Merchant stats
CREATE INDEX idx_merchant_stats_pubkey ON merchant_stats(merchant_pubkey);
CREATE INDEX idx_merchant_stats_score ON merchant_stats(reputation_score DESC);

-- ============================================
-- FUNCTIONS FOR REPUTATION CALCULATION
-- ============================================

CREATE OR REPLACE FUNCTION calculate_merchant_reputation(merchant TEXT)
RETURNS DECIMAL AS $$
DECLARE
  completed INT;
  total INT;
  completion_rate DECIMAL;
  avg_time INT;
  score DECIMAL;
BEGIN
  -- Get metrics
  SELECT
    COALESCE(SUM(CASE WHEN status = 'released' THEN 1 ELSE 0 END), 0),
    COUNT(*),
    AVG(CASE
      WHEN status = 'released' AND released_slot IS NOT NULL AND locked_slot IS NOT NULL
      THEN EXTRACT(EPOCH FROM (released_at - locked_at))
      ELSE NULL
    END)
  INTO completed, total, avg_time
  FROM trades
  WHERE merchant_pubkey = merchant;

  IF total = 0 THEN
    RETURN 0;
  END IF;

  -- Calculate completion rate
  completion_rate := (completed::DECIMAL / total::DECIMAL) * 100;

  -- Base score from completion rate (0-60 points)
  score := completion_rate * 0.6;

  -- Bonus for volume (0-20 points, caps at 100 trades)
  score := score + LEAST(20, (completed::DECIMAL / 5));

  -- Speed bonus (0-20 points, faster = better)
  -- Assuming 1 hour = full points, 24 hours = 0 points
  IF avg_time IS NOT NULL THEN
    score := score + GREATEST(0, 20 - (avg_time::DECIMAL / 3600 * 0.83));
  END IF;

  RETURN LEAST(100, score);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER TO UPDATE MERCHANT STATS
-- ============================================

CREATE OR REPLACE FUNCTION update_merchant_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO merchant_stats (merchant_pubkey)
  VALUES (NEW.merchant_pubkey)
  ON CONFLICT (merchant_pubkey) DO NOTHING;

  UPDATE merchant_stats
  SET
    total_trades = (
      SELECT COUNT(*) FROM trades WHERE merchant_pubkey = NEW.merchant_pubkey
    ),
    total_volume = (
      SELECT COALESCE(SUM(amount), 0) FROM trades WHERE merchant_pubkey = NEW.merchant_pubkey
    ),
    completed_trades = (
      SELECT COUNT(*) FROM trades WHERE merchant_pubkey = NEW.merchant_pubkey AND status = 'released'
    ),
    cancelled_trades = (
      SELECT COUNT(*) FROM trades WHERE merchant_pubkey = NEW.merchant_pubkey AND status = 'refunded'
    ),
    completion_rate = (
      SELECT CASE
        WHEN COUNT(*) > 0
        THEN (SUM(CASE WHEN status = 'released' THEN 1 ELSE 0 END)::DECIMAL / COUNT(*) * 100)
        ELSE 0
      END
      FROM trades WHERE merchant_pubkey = NEW.merchant_pubkey
    ),
    median_completion_time_seconds = (
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (released_at - locked_at)))
      FROM trades
      WHERE merchant_pubkey = NEW.merchant_pubkey
      AND status = 'released'
      AND released_at IS NOT NULL
      AND locked_at IS NOT NULL
    ),
    avg_completion_time_seconds = (
      SELECT AVG(EXTRACT(EPOCH FROM (released_at - locked_at)))
      FROM trades
      WHERE merchant_pubkey = NEW.merchant_pubkey
      AND status = 'released'
      AND released_at IS NOT NULL
      AND locked_at IS NOT NULL
    ),
    fastest_completion_seconds = (
      SELECT MIN(EXTRACT(EPOCH FROM (released_at - locked_at)))
      FROM trades
      WHERE merchant_pubkey = NEW.merchant_pubkey
      AND status = 'released'
      AND released_at IS NOT NULL
      AND locked_at IS NOT NULL
    ),
    reputation_score = calculate_merchant_reputation(NEW.merchant_pubkey),
    last_trade_at = NEW.created_at,
    first_trade_at = COALESCE(
      (SELECT MIN(created_at) FROM trades WHERE merchant_pubkey = NEW.merchant_pubkey),
      NEW.created_at
    ),
    updated_at = NOW()
  WHERE merchant_pubkey = NEW.merchant_pubkey;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_merchant_stats
AFTER INSERT OR UPDATE ON trades
FOR EACH ROW
EXECUTE FUNCTION update_merchant_stats();

-- ============================================
-- INITIAL DATA
-- ============================================

INSERT INTO indexer_cursor (program_id, last_processed_slot)
VALUES ('HZ9ZSXtebTKYGRR7ZNsetroAT7Kh8ymKExcf5FF9dLNq', 0);
