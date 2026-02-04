-- Migration: Add acceptor wallet address for sell orders
-- Date: 2026-02-01
-- Purpose: Store the merchant's wallet address when they accept a sell order
-- This ensures we have the correct wallet for escrow release

-- Add acceptor wallet address column to orders table
-- This is captured when a merchant accepts a sell order (signs with their wallet)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS acceptor_wallet_address VARCHAR(64);

-- Create index for queries that need acceptor wallet
CREATE INDEX IF NOT EXISTS idx_orders_acceptor_wallet ON orders(acceptor_wallet_address)
  WHERE acceptor_wallet_address IS NOT NULL;

-- Comments
COMMENT ON COLUMN orders.acceptor_wallet_address IS 'Wallet address of merchant who accepted the order (captured via signature when accepting sell orders)';
