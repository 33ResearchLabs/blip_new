-- Migration 043: Store each direct message once, track read status per participant.
--
-- Problem: receipt messages insert 2 rows (A→B and B→A) so both parties can
-- track is_read independently.  This wastes storage, doubles write load, and
-- complicates deduplication.
--
-- Fix: move per-recipient read tracking to a separate dm_read_status table.
-- Each message is stored once (the real sender → real recipient), and every
-- participant gets a row in dm_read_status to track their own read state.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Create dm_read_status table
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dm_read_status (
  message_id  uuid NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
  actor_id    uuid NOT NULL,
  is_read     boolean NOT NULL DEFAULT false,
  read_at     timestamp,
  PRIMARY KEY (message_id, actor_id)
);

-- Fast lookup: "all unread messages for this actor"
CREATE INDEX IF NOT EXISTS idx_dm_read_status_unread
  ON dm_read_status (actor_id, is_read) WHERE is_read = false;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Backfill dm_read_status from existing direct_messages rows
-- ═══════════════════════════════════════════════════════════════════

-- For every existing message, create a read-status row for the recipient.
-- The sender is assumed to have "read" their own message.
INSERT INTO dm_read_status (message_id, actor_id, is_read, read_at)
SELECT id, recipient_id, is_read, read_at
FROM direct_messages
ON CONFLICT DO NOTHING;

-- Also create a row for the sender (always read).
INSERT INTO dm_read_status (message_id, actor_id, is_read, read_at)
SELECT id, sender_id, true, created_at
FROM direct_messages
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Deduplicate receipt messages (remove the mirror row)
-- ═══════════════════════════════════════════════════════════════════

-- For every pair of receipt rows where A→B and B→A exist for the same
-- order_receipt, keep the one where sender = acceptor (the original)
-- and delete the mirror.  We identify mirrors by matching content + timestamps
-- within a 2-second window + message_type = 'receipt'.
DELETE FROM direct_messages d
USING direct_messages keeper
WHERE d.message_type = 'receipt'
  AND keeper.message_type = 'receipt'
  AND d.id != keeper.id
  -- Same conversation pair (regardless of direction)
  AND LEAST(d.sender_id, d.recipient_id) = LEAST(keeper.sender_id, keeper.recipient_id)
  AND GREATEST(d.sender_id, d.recipient_id) = GREATEST(keeper.sender_id, keeper.recipient_id)
  -- Same content (receipt text)
  AND d.content = keeper.content
  -- Created within 2 seconds of each other (same receipt batch)
  AND ABS(EXTRACT(EPOCH FROM (d.created_at - keeper.created_at))) < 2
  -- Keep the row with the smaller id (deterministic tiebreaker)
  AND d.id > keeper.id;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Add a conversation_pair column for efficient lookups
-- ═══════════════════════════════════════════════════════════════════

-- Canonical conversation identifier: always (smaller_uuid, larger_uuid)
-- so both parties can query without OR-ing sender/recipient.
ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS conversation_pair uuid[] GENERATED ALWAYS AS (
    ARRAY[LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id)]
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_dm_conversation_pair
  ON direct_messages USING GIN (conversation_pair);

-- ═══════════════════════════════════════════════════════════════════
-- 5. Drop the old per-row read tracking (now in dm_read_status)
-- ═══════════════════════════════════════════════════════════════════
-- Kept as columns for now to avoid breaking running code during deploy.
-- A follow-up migration can DROP them once all code is updated.
-- ALTER TABLE direct_messages DROP COLUMN is_read;
-- ALTER TABLE direct_messages DROP COLUMN read_at;
