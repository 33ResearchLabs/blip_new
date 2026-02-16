-- Reputation scoring system tables
-- Previously created via API call (PUT /api/reputation), now a proper migration

CREATE TABLE IF NOT EXISTS reputation_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL,
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('user', 'merchant')),
  total_score INTEGER NOT NULL DEFAULT 0,
  review_score INTEGER NOT NULL DEFAULT 50,
  execution_score INTEGER NOT NULL DEFAULT 50,
  volume_score INTEGER NOT NULL DEFAULT 0,
  consistency_score INTEGER NOT NULL DEFAULT 0,
  trust_score INTEGER NOT NULL DEFAULT 50,
  tier VARCHAR(20) NOT NULL DEFAULT 'newcomer',
  badges TEXT[] DEFAULT '{}',
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_id, entity_type)
);

CREATE TABLE IF NOT EXISTS reputation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL,
  entity_type VARCHAR(20) NOT NULL,
  total_score INTEGER NOT NULL,
  review_score INTEGER NOT NULL,
  execution_score INTEGER NOT NULL,
  volume_score INTEGER NOT NULL,
  consistency_score INTEGER NOT NULL,
  trust_score INTEGER NOT NULL,
  tier VARCHAR(20) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reputation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL,
  entity_type VARCHAR(20) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  score_change INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reputation_scores_entity
  ON reputation_scores(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_reputation_scores_tier
  ON reputation_scores(tier);
CREATE INDEX IF NOT EXISTS idx_reputation_scores_total
  ON reputation_scores(total_score DESC);
CREATE INDEX IF NOT EXISTS idx_reputation_history_entity
  ON reputation_history(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_reputation_history_date
  ON reputation_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_reputation_events_entity
  ON reputation_events(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_reputation_events_type
  ON reputation_events(event_type);
