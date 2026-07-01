-- 177: Chat Reply metadata
--
-- Adds optional reply support to chat_messages for the messaging upgrade (v1).
-- A reply is a normal message that additionally references the message it
-- replies to. The denormalized preview snapshot lives in the existing
-- `metadata` JSONB (added in migration 086) under `metadata.replyTo`, so a
-- reply reference still renders even if the original is paginated out of the
-- loaded window or later soft-deleted. This migration only adds the FK column
-- plus a lookup index.
--
-- Fully additive and backward-compatible: existing rows get reply_to_id = NULL
-- and render exactly as before. All statements are idempotent.

-- ─── Reply reference column ─────────────────────────────────────────────
-- ON DELETE SET NULL: if an original message is ever hard-deleted (we soft-
-- delete, so this is rare), the reply keeps its metadata.replyTo snapshot and
-- simply loses the clickable jump-to link.
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID
    REFERENCES chat_messages(id) ON DELETE SET NULL;

-- ─── Lookup index ───────────────────────────────────────────────────────
-- Supports "jump to original" and same-order integrity checks. Partial index
-- over just the small subset of messages that are replies. No CONCURRENTLY —
-- core-api wraps migrations in a transaction on startup.
CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to
  ON chat_messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;
