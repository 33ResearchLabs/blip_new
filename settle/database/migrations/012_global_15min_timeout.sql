-- Migration: Global 15-minute order timeout
-- Orders must be completed within 15 minutes of creation, otherwise they're cancelled/expired

-- Update the auto_expire_orders function to use global 15-minute timeout from creation
CREATE OR REPLACE FUNCTION auto_expire_orders()
RETURNS void AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  -- Cancel all active orders that are older than 15 minutes from creation
  -- This applies to ALL statuses except terminal ones (completed, cancelled, expired)
  UPDATE orders
  SET
    status = CASE
      -- If escrow is locked (escrowed status or beyond), go to disputed for manual resolution
      WHEN status IN ('escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'releasing') THEN 'disputed'
      -- Otherwise just cancel
      ELSE 'cancelled'
    END,
    cancelled_at = NOW(),
    cancellation_reason = 'Order timeout - not completed within 15 minutes'
  WHERE
    status NOT IN ('completed', 'cancelled', 'expired', 'disputed')
    AND created_at < NOW() - INTERVAL '15 minutes';

  GET DIAGNOSTICS expired_count = ROW_COUNT;

  -- Log the expiration count
  IF expired_count > 0 THEN
    RAISE NOTICE 'Auto-expired % orders (15-minute global timeout)', expired_count;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Also update any existing orders to have correct expires_at (15 mins from creation)
UPDATE orders
SET expires_at = created_at + INTERVAL '15 minutes'
WHERE status NOT IN ('completed', 'cancelled', 'expired', 'disputed');
