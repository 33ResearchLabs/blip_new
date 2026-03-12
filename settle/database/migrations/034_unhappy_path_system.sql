-- Migration 034: Unhappy Path System
-- Cancel requests (mutual cancel), inactivity tracking, dispute auto-resolve
--
-- Flows:
--   a. Cancel request/approve after acceptance
--   b. Inactivity detection (15min warning, 1hr escalation)
--   c. Dispute 24hr auto-refund to escrow funder
--   d. Non-payment → dispute → 24hr auto-refund

BEGIN;

-- ============================================================
-- 1. CANCEL REQUEST COLUMNS (mutual cancel after acceptance)
-- ============================================================
-- After acceptance, unilateral cancel is not allowed.
-- One party requests cancel, the other approves/declines.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancel_requested_by  VARCHAR(20),      -- 'user' | 'merchant'
  ADD COLUMN IF NOT EXISTS cancel_requested_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_request_reason TEXT;

-- Index for worker to find pending cancel requests
CREATE INDEX IF NOT EXISTS idx_orders_cancel_request
  ON orders (cancel_requested_at)
  WHERE cancel_requested_by IS NOT NULL
    AND status NOT IN ('completed', 'cancelled', 'expired');

-- ============================================================
-- 2. INACTIVITY TRACKING
-- ============================================================
-- Track last meaningful activity on an order.
-- Activity = status change, message sent, extension request/response.
-- Worker checks: if no activity for 15min → flag. 1hr → escalate.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS last_activity_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inactivity_warned_at TIMESTAMPTZ;      -- when 15min warning was sent

-- Backfill: set last_activity_at to most recent timestamp available
UPDATE orders
SET last_activity_at = GREATEST(
  COALESCE(payment_sent_at, '1970-01-01'),
  COALESCE(payment_confirmed_at, '1970-01-01'),
  COALESCE(accepted_at, '1970-01-01'),
  COALESCE(escrowed_at, '1970-01-01'),
  created_at
)
WHERE last_activity_at IS NULL
  AND status NOT IN ('completed', 'cancelled', 'expired');

-- Index for worker to find inactive orders
CREATE INDEX IF NOT EXISTS idx_orders_inactivity
  ON orders (last_activity_at)
  WHERE status NOT IN ('completed', 'cancelled', 'expired', 'disputed', 'pending')
    AND last_activity_at IS NOT NULL;

-- ============================================================
-- 3. DISPUTE AUTO-RESOLVE TRACKING
-- ============================================================
-- disputed_at: when order entered disputed state (for 24hr countdown)
-- dispute_auto_resolve_at: computed deadline = disputed_at + 24h

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS disputed_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_auto_resolve_at TIMESTAMPTZ;

-- Backfill existing disputed orders
UPDATE orders
SET disputed_at = COALESCE(
  (SELECT created_at FROM disputes WHERE disputes.order_id = orders.id LIMIT 1),
  NOW()
),
dispute_auto_resolve_at = COALESCE(
  (SELECT created_at FROM disputes WHERE disputes.order_id = orders.id LIMIT 1),
  NOW()
) + INTERVAL '24 hours'
WHERE status = 'disputed'
  AND disputed_at IS NULL;

-- Index for worker to find disputes nearing auto-resolve
CREATE INDEX IF NOT EXISTS idx_orders_dispute_auto_resolve
  ON orders (dispute_auto_resolve_at)
  WHERE status = 'disputed'
    AND dispute_auto_resolve_at IS NOT NULL;

-- ============================================================
-- 4. FUNCTION: Touch last_activity_at on status changes
-- ============================================================
CREATE OR REPLACE FUNCTION touch_order_activity()
RETURNS TRIGGER AS $$
BEGIN
  -- Update last_activity_at on any status change or payment timestamp update
  IF (OLD.status IS DISTINCT FROM NEW.status)
     OR (OLD.payment_sent_at IS DISTINCT FROM NEW.payment_sent_at)
     OR (OLD.payment_confirmed_at IS DISTINCT FROM NEW.payment_confirmed_at)
     OR (OLD.accepted_at IS DISTINCT FROM NEW.accepted_at)
     OR (OLD.extension_requested_by IS DISTINCT FROM NEW.extension_requested_by)
  THEN
    NEW.last_activity_at = NOW();
  END IF;

  -- Auto-set disputed_at and auto-resolve deadline when entering disputed
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'disputed' THEN
    NEW.disputed_at = NOW();
    NEW.dispute_auto_resolve_at = NOW() + INTERVAL '24 hours';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS trg_touch_order_activity ON orders;
CREATE TRIGGER trg_touch_order_activity
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION touch_order_activity();

-- ============================================================
-- 5. FUNCTION: Touch last_activity_at on new messages
-- ============================================================
CREATE OR REPLACE FUNCTION touch_order_activity_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE orders
  SET last_activity_at = NOW()
  WHERE id = NEW.order_id
    AND status NOT IN ('completed', 'cancelled', 'expired');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_activity_on_message ON chat_messages;
CREATE TRIGGER trg_touch_activity_on_message
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION touch_order_activity_on_message();

COMMIT;
