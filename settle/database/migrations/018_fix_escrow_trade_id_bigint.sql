-- Fix escrow_trade_id column type from integer to bigint
-- This allows storing large timestamp values from Date.now()

-- Change column type to BIGINT (safe - can convert from integer to bigint without data loss)
ALTER TABLE orders
ALTER COLUMN escrow_trade_id TYPE BIGINT;

-- Verify the change
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'orders'
      AND column_name = 'escrow_trade_id'
      AND data_type = 'bigint'
  ) THEN
    RAISE NOTICE 'SUCCESS: escrow_trade_id is now BIGINT';
  ELSE
    RAISE EXCEPTION 'FAILED: escrow_trade_id is still not BIGINT';
  END IF;
END $$;
