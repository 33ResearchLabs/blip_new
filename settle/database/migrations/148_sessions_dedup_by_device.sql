-- ============================================================================
-- 148_sessions_dedup_by_device.sql
--
-- Collapse duplicate ACTIVE sessions for the same DEVICE regardless of IP.
--
-- Follow-up to 147: that pass de-duplicated by (entity, user_agent,
-- ip_address), so the same physical device that signed in from two different
-- IPs (switched network / dynamic ISP address) still showed as two rows. Per
-- product decision, "Active Sessions" now shows ONE row per device (browser +
-- OS via user_agent); the surviving row keeps the most-recent login's IP.
--
-- Pairs with the createSession() device-dedup change, which now collapses by
-- (entity, user_agent) only. This migration cleans the rows already in the
-- table so the change is visible immediately without waiting for the next
-- login on each device.
--
-- Safety / backward compatibility:
--   * Reads & writes ONLY the `sessions` table. Revoking a stale duplicate
--     merely forces that orphan token to re-authenticate.
--   * Idempotent — re-running is a no-op once at most one active session per
--     (entity, user_agent) remains.
--   * No schema change, no column drops, no CASCADE.
--   * The existing idx_sessions_device_dedup (entity, type, user_agent,
--     ip_address) already serves the (entity, type, user_agent) prefix this
--     query needs — no new index required.
--
-- Rollback: none required (only revoked stale duplicate rows).
-- ============================================================================

BEGIN;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY entity_id, entity_type, user_agent
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
