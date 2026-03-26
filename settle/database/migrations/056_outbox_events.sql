-- 056_outbox_events.sql
-- Outbox pattern table for reliable order event delivery.
--
-- Events are inserted atomically with order mutations (inside the same transaction),
-- then processed by a background worker that emits them through the event bus.
-- This guarantees no event is ever lost, even if the process crashes after COMMIT.

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,                         -- e.g. 'order.created', 'order.accepted'
  payload JSONB NOT NULL,                           -- full OrderEventPayload (self-contained)
  status VARCHAR(20) NOT NULL DEFAULT 'pending',    -- 'pending', 'processing', 'processed', 'failed'
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 5,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP,
  last_attempt_at TIMESTAMP,
  last_error TEXT
);

-- Worker polling: only pending events, ordered by creation time
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
  ON outbox_events (status, created_at)
  WHERE status = 'pending';

-- Recovery: find stuck 'processing' records
CREATE INDEX IF NOT EXISTS idx_outbox_events_processing
  ON outbox_events (status, last_attempt_at)
  WHERE status = 'processing';

-- Monitoring: find failed events
CREATE INDEX IF NOT EXISTS idx_outbox_events_failed
  ON outbox_events (status, created_at)
  WHERE status = 'failed';
