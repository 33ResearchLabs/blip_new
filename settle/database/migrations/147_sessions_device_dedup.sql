-- ============================================================================
-- 147_sessions_device_dedup.sql
--
-- Eliminate duplicate ACTIVE session rows for the same device and add a
-- supporting index for the login-time device-dedup query.
--
-- Root cause being remediated:
--   * Refresh-token rotation created a NEW session row on every refresh;
--     concurrent refreshes (multi-tab / polling) each inserted a row, only one
--     of which survived in the cookie — the rest stayed "active" for 7 days.
--   * Repeated logins from the same browser created a fresh session each time
--     with no de-duplication.
--   Result: the merchant "Active Sessions" list showed the same device + IP
--   many times.
--
--   The application code now (a) rotates atomically so only the winner inserts
--   a row, and (b) collapses prior same-device sessions on login. This
--   migration adds the index that (b) relies on and one-time-cleans the
--   duplicates already sitting in the table.
--
-- Safety / backward compatibility:
--   * Reads & writes ONLY the `sessions` table (not a financial/evidentiary
--     table). Revoking a stale session merely forces that orphan token to
--     re-authenticate — it is not in active use.
--   * Additive index + idempotent data fix. Re-running is a no-op once the
--     table holds at most one active session per device.
--   * No schema change, no column drops, no CASCADE.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_sessions_device_dedup;
--   (the cleanup UPDATE is not reversible, but only revoked stale duplicates)
-- ============================================================================

BEGIN;

-- Supporting index for createSession()'s device-dedup UPDATE
-- (entity_id, entity_type, user_agent, ip_address) over active rows only.
CREATE INDEX IF NOT EXISTS idx_sessions_device_dedup
  ON sessions (entity_id, entity_type, user_agent, ip_address)
  WHERE is_revoked = false;

-- One-time cleanup: for each device group (same entity + user_agent +
-- ip_address) of currently-active, unexpired sessions, keep the most recently
-- used row and revoke the rest.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY entity_id, entity_type, user_agent, ip_address
           ORDER BY last_used_at DESC, created_at DESC, id
         ) AS rn
    FROM sessions
   WHERE is_revoked = false
     AND expires_at > NOW()
)
UPDATE sessions s
   SET is_revoked = true,
       revoked_at = NOW()
  FROM ranked r
 WHERE s.id = r.id
   AND r.rn > 1;

COMMIT;
