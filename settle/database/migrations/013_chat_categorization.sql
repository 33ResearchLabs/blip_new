-- Migration 013: Add chat categorization for merchant chat tabs
-- Adds has_manual_message column to track Direct vs Automated chats

-- Add has_manual_message column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_manual_message BOOLEAN DEFAULT false;

-- Create index for efficient tab filtering
CREATE INDEX IF NOT EXISTS idx_orders_chat_categorization
ON orders(merchant_id, has_manual_message, status)
WHERE status NOT IN ('completed', 'cancelled', 'expired');

-- Set has_manual_message = true for orders that already have non-system messages
UPDATE orders o
SET has_manual_message = true
WHERE EXISTS (
  SELECT 1 FROM chat_messages cm
  WHERE cm.order_id = o.id
    AND cm.sender_type IN ('user', 'merchant')
    AND cm.message_type != 'system'
);
