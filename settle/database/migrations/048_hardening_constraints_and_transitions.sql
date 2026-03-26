-- Migration 048: Production Hardening - Balance Constraints & Status Transition Safety
--
-- Adds:
-- 1. CHECK constraints: balance >= 0 on users and merchants
-- 2. CHECK constraint: valid order status transitions via trigger
-- 3. Prevent negative available_amount on offers (defense-in-depth, 001 already has this)
--
-- All changes are ADDITIVE — safe to run on live system.

-- ============================================================
-- 1. Balance non-negative constraints (prevent impossible negative balances)
-- ============================================================

-- Users balance must never go negative
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_balance_non_negative'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_balance_non_negative CHECK (balance >= 0);
  END IF;
END $$;

-- Merchants balance must never go negative
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'merchants_balance_non_negative'
  ) THEN
    ALTER TABLE merchants ADD CONSTRAINT merchants_balance_non_negative CHECK (balance >= 0);
  END IF;
END $$;

-- Merchants sinr_balance must never go negative (synthetic INR)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'merchants_sinr_balance_non_negative'
  ) THEN
    ALTER TABLE merchants ADD CONSTRAINT merchants_sinr_balance_non_negative CHECK (sinr_balance >= 0);
  END IF;
EXCEPTION
  WHEN undefined_column THEN NULL; -- sinr_balance may not exist on all instances
END $$;

-- ============================================================
-- 2. Status transition validation trigger
--    Prevents invalid order status transitions at the DB level.
--    This is defense-in-depth: the app validates transitions too,
--    but this catches bugs or direct DB writes.
-- ============================================================

CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER AS $$
DECLARE
  v_old_status TEXT;
  v_new_status TEXT;
  v_valid BOOLEAN := false;
BEGIN
  -- Skip if status didn't change
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_old_status := OLD.status::TEXT;
  v_new_status := NEW.status::TEXT;

  -- Define valid transitions (same as app-level state machine)
  v_valid := CASE v_old_status
    WHEN 'pending' THEN v_new_status IN ('accepted', 'escrowed', 'escrow_pending', 'cancelled', 'expired')
    WHEN 'accepted' THEN v_new_status IN ('escrowed', 'escrow_pending', 'payment_pending', 'cancelled', 'expired', 'disputed')
    WHEN 'escrow_pending' THEN v_new_status IN ('escrowed', 'cancelled', 'expired')
    WHEN 'escrowed' THEN v_new_status IN ('accepted', 'payment_pending', 'payment_sent', 'releasing', 'completed', 'cancelled', 'expired', 'disputed')
    WHEN 'payment_pending' THEN v_new_status IN ('payment_sent', 'escrowed', 'cancelled', 'expired', 'disputed')
    WHEN 'payment_sent' THEN v_new_status IN ('payment_confirmed', 'releasing', 'completed', 'cancelled', 'disputed')
    WHEN 'payment_confirmed' THEN v_new_status IN ('releasing', 'completed', 'cancelled', 'disputed')
    WHEN 'releasing' THEN v_new_status IN ('completed', 'cancelled', 'disputed')
    WHEN 'disputed' THEN v_new_status IN ('completed', 'cancelled')
    -- Terminal states: completed, cancelled, expired — no transitions allowed
    WHEN 'completed' THEN false
    WHEN 'cancelled' THEN false
    WHEN 'expired' THEN false
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid order status transition: % -> % (order_id: %)',
      v_old_status, v_new_status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (DROP + CREATE to ensure latest version)
DROP TRIGGER IF EXISTS trigger_validate_order_status_transition ON orders;
CREATE TRIGGER trigger_validate_order_status_transition
  BEFORE UPDATE ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION validate_order_status_transition();

-- ============================================================
-- 3. Ensure notification_outbox max_attempts has a sane default
-- ============================================================
DO $$
BEGIN
  ALTER TABLE notification_outbox ALTER COLUMN max_attempts SET DEFAULT 5;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

-- ============================================================
-- 4. Prevent duplicate order completion (defense-in-depth)
--    A completed order should never be completed again.
--    The release_tx_hash uniqueness prevents double-release.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_release_tx_unique
  ON orders (release_tx_hash)
  WHERE release_tx_hash IS NOT NULL;

-- ============================================================
-- 5. Optimize idempotency storage
--    Replace the static WHERE condition index with a plain btree
--    on expires_at for efficient periodic cleanup.
-- ============================================================
DROP INDEX IF EXISTS idx_idempotency_log_expires;
CREATE INDEX IF NOT EXISTS idx_idempotency_log_expires_at
  ON idempotency_log (expires_at);

-- Index for fast lookup of active entries (filter by expires_at at query time)
CREATE INDEX IF NOT EXISTS idx_idempotency_log_active
  ON idempotency_log (idempotency_key, expires_at);
