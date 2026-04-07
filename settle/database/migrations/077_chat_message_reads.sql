-- ============================================================================
-- 077_chat_message_reads.sql
--
-- ADDITIVE — per-actor read state for chat messages.
--
-- chat_messages.is_read is a single global boolean. In a 3-party conversation
-- (user + merchant + compliance) marking-read by one party clears the unread
-- badge for the others. This new table moves read state to per-(message,actor)
-- granularity, mirroring the dm_read_status pattern that already works for DMs.
--
-- Backward compatibility:
--   * chat_messages.is_read is NOT removed. Old code keeps reading it.
--   * New code dual-writes: UPDATE chat_messages.is_read AND insert here.
--   * Eventually (separate future migration, not in this rollout) is_read can
--     be deprecated and dropped.
--
-- Rollback:
--   DROP TABLE IF EXISTS chat_message_reads;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS chat_message_reads (
  message_id  UUID         NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  actor_type  actor_type   NOT NULL,
  actor_id    UUID         NOT NULL,
  read_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, actor_type, actor_id)
);

-- Hot path: "how many unread messages does this actor have?"
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_actor
  ON chat_message_reads (actor_type, actor_id);

-- Lookup path: "is this specific message read by this actor?"
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_message
  ON chat_message_reads (message_id);

COMMIT;
