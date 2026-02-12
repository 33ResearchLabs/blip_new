-- Fix escrow_trade_id column type from integer to bigint
-- This allows storing large timestamp values from Date.now()

-- Check current column type
SELECT column_name, data_type, numeric_precision
FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'escrow_trade_id';

-- If the column is INTEGER, change it to BIGINT
ALTER TABLE orders
ALTER COLUMN escrow_trade_id TYPE BIGINT;

-- Verify the change
SELECT column_name, data_type, numeric_precision
FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'escrow_trade_id';
