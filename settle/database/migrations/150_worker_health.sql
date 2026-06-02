-- ============================================================================
-- 150_worker_health.sql
--
-- Durable, cross-fleet worker heartbeat + health state.
--
-- Replaces the ephemeral, per-process /tmp/bm-worker-*.json heartbeat files
-- (which are host-local, lost on restart, written by only some workers, and
-- read by nothing across the settle <-> core-api process boundary) with a
-- single Postgres table both fleets upsert into on every tick.
--
-- Used by:
--   * the per-tick heartbeat helpers (apps/core-api/src/workers/workerHealth.ts
--     and settle/src/lib/workerHealth.ts) — one cheap UPSERT per 25-60s tick
--   * the worker health checker (runs every ~60s, flags stale/stuck workers)
--   * the /admin/worker-health dashboard
--
-- Stall detection relies on three signals stored here:
--   * last_tick_at      — liveness: is the loop still firing?
--   * tick_seq          — is the loop re-arming, or alive-but-frozen?
--   * items_processed   — is it draining work, or running-but-not-progressing?
--
-- Safety / backward compatibility:
--   * Purely additive: one new table + two indexes. No drops, no CASCADE,
--     no data backfill, no changes to any existing table.
--   * Nothing reads or writes this table until later phases are deployed, so
--     applying this migration alone is a no-op for runtime behaviour.
--   * Idempotent (IF NOT EXISTS everywhere) — safe to re-run on every startup
--     by core-api's migrationRunner (which applies this dir for BOTH fleets).
--   * No CREATE INDEX CONCURRENTLY (the runner wraps each file in a txn).
--
-- Rollback:
--   DROP TABLE IF EXISTS worker_health;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS worker_health (
  worker_name           TEXT PRIMARY KEY,                 -- stable id, e.g. 'payment-deadline-worker'
  fleet                 TEXT        NOT NULL DEFAULT 'unknown',   -- 'core-api' | 'settle'
  status                TEXT        NOT NULL DEFAULT 'unknown',   -- healthy|warning|critical|stopped|unknown
  criticality           TEXT        NOT NULL DEFAULT 'medium',    -- critical|high|medium|low
  expected_interval_ms  INTEGER,                          -- declared cadence; drives stall thresholds
  last_tick_at          TIMESTAMPTZ,                      -- start of most recent tick (liveness)
  last_ok_at            TIMESTAMPTZ,                      -- last successful tick
  last_error            TEXT,                             -- message from most recent failed tick
  tick_seq              BIGINT      NOT NULL DEFAULT 0,   -- monotonic; detects "alive but stuck"
  items_processed       BIGINT      NOT NULL DEFAULT 0,   -- cumulative work done (progress signal)
  last_batch_size       INTEGER,                          -- items handled in the most recent tick
  consecutive_errors    INTEGER     NOT NULL DEFAULT 0,   -- resets to 0 on a successful tick
  alerted_at            TIMESTAMPTZ,                      -- last time an alert fired (cooldown bookkeeping)
  pid                   INTEGER,                          -- OS pid of the worker process (best-effort)
  host                  TEXT,                             -- hostname of the worker process (best-effort)
  metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dashboard groups/filters by status; checker scans by staleness of last_tick_at.
CREATE INDEX IF NOT EXISTS idx_worker_health_status     ON worker_health (status);
CREATE INDEX IF NOT EXISTS idx_worker_health_last_tick  ON worker_health (last_tick_at);

COMMIT;
