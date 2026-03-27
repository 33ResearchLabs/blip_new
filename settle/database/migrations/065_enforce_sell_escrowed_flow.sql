-- Migration 065: Enforce SELL order flow constraints
--
-- SELL orders must follow the escrow-first model:
--   escrowed → payment_sent → completed
--
-- They must NEVER enter 'pending' or 'accepted' status.
-- BUY orders must pass through 'accepted' before 'escrowed'.
--
-- This migration adds CHECK constraints and a trigger to enforce these rules.

-- ═══════════════════════════════════════════════════════════════════════
-- 0. FIX EXISTING DATA: Migrate legacy SELL orders stuck in pending/accepted
-- ═══════════════════════════════════════════════════════════════════════

-- SELL orders in 'pending' that never had escrow → cancel them (they can't proceed without escrow)
UPDATE orders
SET status = 'cancelled',
    cancelled_at = COALESCE(cancelled_at, NOW())
WHERE type = 'sell'
  AND status = 'pending'
  AND escrow_tx_hash IS NULL;

-- SELL orders in 'pending' that DO have escrow → promote to 'escrowed'
UPDATE orders
SET status = 'escrowed',
    escrowed_at = COALESCE(escrowed_at, NOW())
WHERE type = 'sell'
  AND status = 'pending'
  AND escrow_tx_hash IS NOT NULL;

-- SELL orders in 'accepted' that never had escrow → cancel them
UPDATE orders
SET status = 'cancelled',
    cancelled_at = COALESCE(cancelled_at, NOW())
WHERE type = 'sell'
  AND status = 'accepted'
  AND escrow_tx_hash IS NULL;

-- SELL orders in 'accepted' that DO have escrow → promote to 'escrowed'
UPDATE orders
SET status = 'escrowed',
    escrowed_at = COALESCE(escrowed_at, NOW())
WHERE type = 'sell'
  AND status = 'accepted'
  AND escrow_tx_hash IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. CHECK CONSTRAINT: SELL orders cannot be in 'pending' or 'accepted'
--    (safe now — no violating rows remain)
-- ═══════════════════════════════════════════════════════════════════════

-- NOTE: We do NOT use a CHECK constraint here because merchant-created orders
-- use placeholder users and store inverted types (merchant "buy" = stored "sell").
-- These broadcast orders legitimately start as 'pending' even with type='sell'.
-- Enforcement is done via the trigger below which can query the users table.
--
-- The rule: SELL orders created by REAL users must have escrow at creation.
-- Merchant-created orders (placeholder users like open_order_*, m2m_*) are exempt.

-- ═══════════════════════════════════════════════════════════════════════
-- 2. TRIGGER: Validate status transitions per order type
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER AS $$
DECLARE
  _username TEXT;
  _is_placeholder BOOLEAN;
BEGIN
  -- Skip if status hasn't changed
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Look up the user to determine if this is a merchant-created order (placeholder user)
  SELECT username INTO _username FROM users WHERE id = NEW.user_id;
  _is_placeholder := (_username LIKE 'open_order_%' OR _username LIKE 'm2m_%');

  -- ── SELL flow guards ──────────────────────────────────────────────
  -- Only enforce for REAL user-created orders.
  -- Merchant-created orders (placeholder users) are exempt — they use inverted types
  -- and legitimately start as 'pending' with type='sell'.
  IF NEW.type = 'sell' AND NOT _is_placeholder THEN
    IF NEW.status IN ('pending', 'accepted') THEN
      RAISE EXCEPTION 'User SELL orders cannot enter status %. SELL flow: escrowed → payment_sent → completed', NEW.status;
    END IF;
  END IF;

  -- ── BUY flow guards ───────────────────────────────────────────────
  IF NEW.type = 'buy' AND NOT _is_placeholder THEN
    -- BUY orders cannot go from 'pending' directly to 'escrowed' (must pass through 'accepted')
    IF OLD.status = 'pending' AND NEW.status = 'escrowed' THEN
      RAISE EXCEPTION 'BUY orders must be accepted before escrow. Required: pending → accepted → escrowed';
    END IF;
  END IF;

  -- ── Universal guards (no backward transitions) ────────────────────
  -- Prevent backward transitions on the happy path
  -- Order: pending(0) → accepted(1) → escrowed(2) → payment_sent(3) → completed(4)
  -- Cancel/expire/dispute can happen from any active state

  IF NEW.status NOT IN ('cancelled', 'expired', 'disputed') THEN
    -- Map statuses to ordinal positions
    DECLARE
      old_ord INT;
      new_ord INT;
    BEGIN
      old_ord := CASE OLD.status
        WHEN 'pending' THEN 0
        WHEN 'accepted' THEN 1
        WHEN 'escrow_pending' THEN 1
        WHEN 'escrowed' THEN 2
        WHEN 'payment_pending' THEN 2
        WHEN 'payment_sent' THEN 3
        WHEN 'payment_confirmed' THEN 3
        WHEN 'releasing' THEN 4
        WHEN 'completed' THEN 4
        ELSE -1
      END;

      new_ord := CASE NEW.status
        WHEN 'pending' THEN 0
        WHEN 'accepted' THEN 1
        WHEN 'escrow_pending' THEN 1
        WHEN 'escrowed' THEN 2
        WHEN 'payment_pending' THEN 2
        WHEN 'payment_sent' THEN 3
        WHEN 'payment_confirmed' THEN 3
        WHEN 'releasing' THEN 4
        WHEN 'completed' THEN 4
        ELSE -1
      END;

      -- Reject backward transitions (lower ordinal)
      IF old_ord >= 0 AND new_ord >= 0 AND new_ord < old_ord THEN
        RAISE EXCEPTION 'Backward status transition not allowed: % → %', OLD.status, NEW.status;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_validate_order_status_transition ON orders;
CREATE TRIGGER trg_validate_order_status_transition
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_order_status_transition();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. CONSTRAINT: Prevent double escrow (idempotency)
-- ═══════════════════════════════════════════════════════════════════════

-- Ensure escrow_tx_hash is unique when set (prevents double-lock)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_escrow_tx_hash
  ON orders (escrow_tx_hash)
  WHERE escrow_tx_hash IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. CONSTRAINT: Prevent multiple merchants claiming same order
-- ═══════════════════════════════════════════════════════════════════════

-- buyer_merchant_id should not change once set (handled by trigger)
CREATE OR REPLACE FUNCTION prevent_buyer_merchant_reassignment()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.buyer_merchant_id IS NOT NULL
     AND NEW.buyer_merchant_id IS NOT NULL
     AND OLD.buyer_merchant_id != NEW.buyer_merchant_id THEN
    RAISE EXCEPTION 'Cannot reassign buyer_merchant_id once set. Order % already claimed by %', OLD.id, OLD.buyer_merchant_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_buyer_merchant_reassignment ON orders;
CREATE TRIGGER trg_prevent_buyer_merchant_reassignment
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_buyer_merchant_reassignment();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. CONSTRAINT: Prevent double release
-- ═══════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_release_tx_hash
  ON orders (release_tx_hash)
  WHERE release_tx_hash IS NOT NULL;
