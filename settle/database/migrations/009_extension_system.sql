-- Migration: Add extension system columns to orders
-- Date: 2026-02-01
-- Required by: stateMachine.ts extension system

-- Add extension tracking columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS extension_count INT DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS max_extensions INT DEFAULT 3;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS extension_requested_by actor_type;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS extension_requested_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_extended_at TIMESTAMP;

-- Add buyer wallet address for 'buy' orders (user provides wallet to receive crypto)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_wallet_address VARCHAR(64);

-- Create index for extension queries
CREATE INDEX IF NOT EXISTS idx_orders_extension_pending ON orders(extension_requested_at)
  WHERE extension_requested_by IS NOT NULL AND status NOT IN ('completed', 'cancelled', 'expired');

-- Comments
COMMENT ON COLUMN orders.extension_count IS 'Number of time extensions granted for this order';
COMMENT ON COLUMN orders.max_extensions IS 'Maximum allowed extensions (default 3)';
COMMENT ON COLUMN orders.extension_requested_by IS 'Actor who requested the current pending extension';
COMMENT ON COLUMN orders.extension_requested_at IS 'When the current extension was requested';
COMMENT ON COLUMN orders.last_extended_at IS 'When the order was last extended';
COMMENT ON COLUMN orders.buyer_wallet_address IS 'Wallet address for buyer to receive crypto (for buy orders)';
