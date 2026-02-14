-- Add order_version column for optimistic locking and UI updates
-- Part of atomic completion implementation

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_version INT DEFAULT 1 NOT NULL;

-- Add index for efficient version queries
CREATE INDEX IF NOT EXISTS idx_orders_version ON orders(id, order_version);

-- Backfill existing orders with version 1
UPDATE orders SET order_version = 1 WHERE order_version IS NULL OR order_version = 0;
