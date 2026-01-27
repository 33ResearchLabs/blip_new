-- Migration: Auto-expire orders after 15 minutes
-- This creates a function and trigger to automatically expire pending orders

-- Function to expire orders that have passed their expires_at time
CREATE OR REPLACE FUNCTION auto_expire_orders()
RETURNS void AS $$
BEGIN
  -- Update pending orders that have expired
  UPDATE orders
  SET
    status = 'expired',
    cancelled_at = NOW(),
    cancellation_reason = 'Order expired - merchant did not accept within 15 minutes'
  WHERE
    status = 'pending'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  -- Log the expiration count
  RAISE NOTICE 'Auto-expired % pending orders', (
    SELECT COUNT(*)
    FROM orders
    WHERE status = 'expired'
    AND cancelled_at >= NOW() - INTERVAL '1 second'
  );
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled check (requires pg_cron extension)
-- Note: This is optional and requires pg_cron to be installed
-- Alternatively, the API can call this function periodically

-- For manual testing:
-- SELECT auto_expire_orders();
