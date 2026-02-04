-- Migration: Add support for merchant-to-merchant (M2M) trading
-- When a merchant trades with another merchant, buyer_merchant_id tracks the buying merchant

-- Add buyer_merchant_id column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_merchant_id UUID REFERENCES merchants(id);

-- Create index for querying M2M orders
CREATE INDEX IF NOT EXISTS idx_orders_buyer_merchant ON orders(buyer_merchant_id, status);

-- Add comment explaining the column
COMMENT ON COLUMN orders.buyer_merchant_id IS 'When a merchant acts as a buyer in a trade with another merchant (M2M trading)';
