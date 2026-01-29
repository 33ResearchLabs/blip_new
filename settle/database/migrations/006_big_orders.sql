-- Migration: Add big order threshold and custom order flags
-- Date: 2026-01-29

-- Add big order threshold setting to merchants (default 10,000 AED)
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS big_order_threshold DECIMAL(20, 2) DEFAULT 10000;

-- Add custom order flags for manually flagged/special orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS premium_percent DECIMAL(5, 2) DEFAULT 0;

-- Add index for efficient big order queries
CREATE INDEX IF NOT EXISTS idx_orders_fiat_amount ON orders(merchant_id, fiat_amount DESC) WHERE status NOT IN ('cancelled', 'expired');

-- Add index for custom orders
CREATE INDEX IF NOT EXISTS idx_orders_custom ON orders(merchant_id, is_custom) WHERE is_custom = true;

-- Comment on new columns
COMMENT ON COLUMN merchants.big_order_threshold IS 'Minimum fiat amount to be considered a big order';
COMMENT ON COLUMN orders.is_custom IS 'Flag for manually marked special/custom orders';
COMMENT ON COLUMN orders.custom_notes IS 'Notes for custom orders';
COMMENT ON COLUMN orders.premium_percent IS 'Premium percentage offered for this order';
