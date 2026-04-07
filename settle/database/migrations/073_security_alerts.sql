-- Security alerts table for the admin monitor dashboard
-- Stores guard-triggered alerts so they survive server restarts

CREATE TABLE IF NOT EXISTS security_alerts (
  id            SERIAL PRIMARY KEY,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type          VARCHAR(30) NOT NULL,
  severity      VARCHAR(10) NOT NULL CHECK (severity IN ('HIGH', 'MEDIUM')),
  message       TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  acknowledged  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_timestamp ON security_alerts (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts (severity, timestamp DESC);
