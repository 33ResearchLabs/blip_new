-- 140_waitlist_community.sql (Phase E — Tier 3 graph community detection)
--
-- One row per actor that has been assigned to a community by the
-- /api/cron/waitlist-graph-rebuild pipeline. Used by the threat-detection
-- pipeline to populate the COMMUNITY_DENSITY_OUTLIER signal and to expose
-- the actor's community context on the admin detail modal.
--
-- Computed by the cron pipeline:
--   1. Build actor graph (nodes = waitlisted actors, edges weighted by
--      referrals + shared IPs + shared device fingerprints).
--   2. Weighted label-propagation to find communities.
--   3. Per-community + per-actor anomaly metrics.
--   4. Bulk upsert into this table.
--
-- Additive-only. No FKs to users/merchants (cascade-safe — actor pointer
-- is a soft reference and the cron pipeline simply skips deleted actors).

BEGIN;

CREATE TABLE IF NOT EXISTS waitlist_community_membership (
  actor_id            uuid NOT NULL,
  actor_type          text NOT NULL,
  community_id        text NOT NULL,
  anomaly_score       real NOT NULL DEFAULT 0,    -- 0..100
  -- Per-community context (denormalised here so the admin detail view doesn't
  -- need a second query; refreshed on every cron run anyway).
  community_size      integer NOT NULL DEFAULT 1,
  community_density   real NOT NULL DEFAULT 0,    -- 0..1
  age_spread_seconds  integer NOT NULL DEFAULT 0,
  unique_ips          integer NOT NULL DEFAULT 0,
  unique_devices      integer NOT NULL DEFAULT 0,
  last_computed_at    timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor_type, actor_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'waitlist_community_membership_actor_type_check'
  ) THEN
    ALTER TABLE waitlist_community_membership
      ADD CONSTRAINT waitlist_community_membership_actor_type_check
      CHECK (actor_type IN ('user','merchant'));
  END IF;
END$$;

-- Lookup-by-community for the admin detail modal (list other members).
CREATE INDEX IF NOT EXISTS idx_wl_community_id
  ON waitlist_community_membership (community_id);

-- Range/sort on anomaly_score for "highest-anomaly first" admin queries.
CREATE INDEX IF NOT EXISTS idx_wl_community_anomaly
  ON waitlist_community_membership (anomaly_score DESC)
  WHERE anomaly_score > 0;

-- Used by the cron pipeline to find stale rows to prune.
CREATE INDEX IF NOT EXISTS idx_wl_community_computed
  ON waitlist_community_membership (last_computed_at);

COMMIT;
