-- Migration 070: Persistent Risk Profiles
-- Stores computed risk_score per entity. Updated non-blocking on each risk_event.
-- Read-only for admin — never used for blocking or modifying user behavior.

BEGIN;

CREATE TABLE IF NOT EXISTS risk_profiles (
  entity_id          UUID PRIMARY KEY,
  entity_type        VARCHAR(20) NOT NULL CHECK (entity_type IN ('user', 'merchant')),
  risk_score         INTEGER NOT NULL DEFAULT 0 CHECK (risk_score >= 0),
  risk_level         VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  event_count        INTEGER NOT NULL DEFAULT 0,
  last_event_type    VARCHAR(50),
  last_event_at      TIMESTAMPTZ,
  last_recalc_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_profiles_level ON risk_profiles(risk_level);
CREATE INDEX IF NOT EXISTS idx_risk_profiles_score ON risk_profiles(risk_score DESC);

COMMIT;
