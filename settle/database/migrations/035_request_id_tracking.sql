-- Migration 035: Add request_id tracking to order_events
-- Enables end-to-end request tracing across settle → core-api → DB

-- 1. Add nullable request_id column to order_events
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS request_id TEXT;

-- 2. Index for request_id lookups (find all events from a single request)
CREATE INDEX IF NOT EXISTS idx_order_events_request_id
  ON order_events(request_id)
  WHERE request_id IS NOT NULL;
