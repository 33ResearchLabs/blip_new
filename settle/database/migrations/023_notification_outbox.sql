-- Notification Outbox Table
-- Ensures reliable delivery of notifications even if Pusher/WebSocket fails
-- Worker processes this table with retries

CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL, -- 'ORDER_COMPLETED', 'ORDER_CANCELLED', 'ORDER_DISPUTED', etc.
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payload JSONB NOT NULL, -- Full notification payload
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 5,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'sent', 'failed'
  last_attempt_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  sent_at TIMESTAMP
);

-- Index for efficient worker polling
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON notification_outbox(status, created_at)
  WHERE status IN ('pending', 'failed');

-- Index for order lookup
CREATE INDEX IF NOT EXISTS idx_outbox_order_id ON notification_outbox(order_id);

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_outbox_sent ON notification_outbox(sent_at)
  WHERE status = 'sent';
