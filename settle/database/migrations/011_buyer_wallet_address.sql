-- Migration: Add buyer_wallet_address column to orders
-- Date: 2026-02-04
-- Purpose: Store the buyer's wallet address for receiving crypto on buy orders

-- Add buyer wallet address column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_wallet_address VARCHAR(64);

-- Create index for queries that filter by buyer wallet
CREATE INDEX IF NOT EXISTS idx_orders_buyer_wallet ON orders(buyer_wallet_address)
  WHERE buyer_wallet_address IS NOT NULL;

-- Comment
COMMENT ON COLUMN orders.buyer_wallet_address IS 'Wallet address where buyer wants to receive crypto (for buy orders)';
