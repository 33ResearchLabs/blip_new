-- ============================================================================
-- 076_chat_seq_and_client_id.sql
--
-- ADDITIVE chat hardening — phase 1 of the realtime stabilization plan.
--
-- Adds:
--   1. chat_messages.seq        BIGSERIAL  — monotonic ordering tiebreaker
--   2. chat_messages.client_id  UUID       — idempotent send key
--   3. partial unique index on (sender_id, client_id) WHERE client_id IS NOT NULL
--   4. composite index on (order_id, seq DESC) for fast newest-first reads
--
-- Backward compatibility:
--   * Existing INSERTs that don't specify seq → BIGSERIAL auto-fills.
--   * Existing INSERTs that don't specify client_id → NULL, partial index ignores.
--   * Existing SELECTs that don't reference these columns are unaffected.
--   * chat_messages.is_read is NOT touched.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_chat_messages_order_seq;
--   DROP INDEX IF EXISTS uq_chat_messages_client_id;
--   ALTER TABLE chat_messages
--     DROP COLUMN IF EXISTS client_id,
--     DROP COLUMN IF EXISTS seq;
-- ============================================================================

BEGIN;

-- 1. Monotonic sequence column for deterministic ordering.
--    BIGSERIAL auto-fills on INSERT; existing rows get a value via the
--    backfill below. Two messages can no longer collide on created_at.
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS seq BIGSERIAL;

-- 2. Client-generated UUID for idempotent sends. Nullable so existing
--    inserts that don't pass it continue to work unchanged.
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS client_id UUID;

-- 3. Partial unique index — only enforces uniqueness when client_id is
--    provided. NULL rows (every existing row) are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_client_id
  ON chat_messages (sender_id, client_id)
  WHERE client_id IS NOT NULL;

-- 4. Composite index for ORDER BY (order_id, seq DESC) — the new fetch path.
CREATE INDEX IF NOT EXISTS idx_chat_messages_order_seq
  ON chat_messages (order_id, seq DESC);

-- 5. Backfill seq for existing rows in chronological order. BIGSERIAL has
--    already assigned arbitrary values on the ALTER above; this UPDATE
--    re-numbers them so seq matches insertion order historically.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS new_seq
  FROM chat_messages
)
UPDATE chat_messages cm
SET seq = ordered.new_seq
FROM ordered
WHERE cm.id = ordered.id;

-- 6. Reset the sequence so future INSERTs continue past the backfilled max.
SELECT setval(
  pg_get_serial_sequence('chat_messages', 'seq'),
  COALESCE((SELECT MAX(seq) FROM chat_messages), 0) + 1,
  false
);

COMMIT;
