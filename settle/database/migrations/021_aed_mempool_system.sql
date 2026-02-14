-- Migration 021: AED Mempool + Gas Pricing System
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
  ADD COLUMN IF NOT EXISTS winner_merchant_id UUID REFERENCES merchants(id),
  ADD COLUMN IF NOT EXISTS next_bump_at TIMESTAMP;

-- Merchant quotes (pricing preferences per corridor)
CREATE TABLE IF NOT EXISTS merchant_quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_merchant_quotes_online ON merchant_quotes(corridor_id, is_online) WHERE is_online = TRUE;
CREATE INDEX IF NOT EXISTS idx_merchant_quotes_merchant ON merchant_quotes(merchant_id);

-- Order events (audit log)
CREATE TABLE IF NOT EXISTS order_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

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
  p_order_id UUID,
  p_merchant_id UUID
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
