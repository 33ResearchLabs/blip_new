-- Track once-per-trade emission of the 5-minute expiry warning.
--
-- The unhappy-path worker fires `EXPIRY_WARNING` when a non-terminal order
-- has <= 5 minutes left before `expires_at`. Setting this column with an
-- order_version guard keeps the warning idempotent across worker ticks and
-- protects against double-fires under concurrent polling.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS expiry_warning_sent_at TIMESTAMPTZ NULL;

-- Partial index supports the worker's scan: orders not yet warned, with
-- a soon-to-pass expires_at, in non-terminal status. Keeps the query
-- O(log n) on the warn cohort even as the table grows.
CREATE INDEX IF NOT EXISTS idx_orders_expiry_warning_pending
  ON public.orders (expires_at)
  WHERE expiry_warning_sent_at IS NULL
    AND status NOT IN ('completed', 'cancelled', 'expired', 'disputed');
