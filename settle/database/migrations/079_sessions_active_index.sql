-- ============================================================================
-- 079_sessions_active_index.sql
--
-- ADDITIVE — covering index for the "is this entity currently active?" check.
--
-- Why:
--   hasNoActiveSessions() in src/lib/auth/sessions.ts runs on every auth
--   request that presents a legacy token without sessionId (a large share
--   of production traffic). The query filters by
--     (entity_id, entity_type, is_revoked = false, expires_at > NOW())
--
--   The existing index idx_sessions_entity covers (entity_id, entity_type)
--   with a partial WHERE is_revoked = false, but does NOT include
--   expires_at. Postgres therefore heap-fetches every matching row to
--   check the timestamp. On a merchant with many historical sessions
--   this was measured at ~750ms.
--
--   This index adds expires_at as a second column so the planner can
--   satisfy the full WHERE clause from the index alone, combined with
--   the EXISTS rewrite in hasNoActiveSessions().
--
-- Backward compatibility:
--   * Pure additive index — no data changes, no schema changes.
--   * The existing idx_sessions_entity is NOT removed; it still serves
--     other queries (list sessions, revoke all for entity, etc.).
--   * Safe to rerun — IF NOT EXISTS guard.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_sessions_entity_active;
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_sessions_entity_active
  ON sessions (entity_id, entity_type, expires_at)
  WHERE is_revoked = false;

COMMIT;
