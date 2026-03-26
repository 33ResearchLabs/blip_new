-- Migration 062: Guard buyer_merchant_id — only allow on M2M orders (placeholder user)
--
-- buyer_merchant_id should ONLY be set when:
--   1. Order was created by a placeholder user (open_order_* or m2m_*)
--   2. It's being set during creation (from merchant order route)
--
-- For real user orders, buyer_merchant_id must remain NULL.
-- This trigger prevents any code path from accidentally setting it.

CREATE OR REPLACE FUNCTION guard_buyer_merchant_id()
RETURNS TRIGGER AS $$
DECLARE
  v_username VARCHAR;
BEGIN
  -- Only check when buyer_merchant_id is being SET (was NULL, now NOT NULL)
  IF OLD.buyer_merchant_id IS NULL AND NEW.buyer_merchant_id IS NOT NULL THEN
    SELECT username INTO v_username FROM users WHERE id = NEW.user_id;

    -- Allow for placeholder users (M2M orders) and NULL usernames (edge case)
    IF v_username IS NOT NULL
       AND v_username NOT LIKE 'open_order_%'
       AND v_username NOT LIKE 'm2m_%' THEN
      -- Block: real user order should not have buyer_merchant_id
      RAISE WARNING 'Blocked buyer_merchant_id assignment on user order (user=%, order=%). Only M2M orders can have buyer_merchant_id.', v_username, NEW.id;
      NEW.buyer_merchant_id := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists (idempotent)
DROP TRIGGER IF EXISTS trg_guard_buyer_merchant_id ON orders;

CREATE TRIGGER trg_guard_buyer_merchant_id
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION guard_buyer_merchant_id();
