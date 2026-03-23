-- Add 'receipt' to the message_type enum and add a receipt_data JSONB column
-- so receipt messages are stored as structured data instead of JSON strings in content.

-- 1. Extend the enum (idempotent — safe to re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'receipt'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'message_type')
  ) THEN
    ALTER TYPE message_type ADD VALUE 'receipt';
  END IF;
END$$;

-- 2. Add receipt_data column to chat_messages
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS receipt_data jsonb;

-- 3. Add receipt_data column to direct_messages and allow 'receipt' message_type
ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS receipt_data jsonb;

-- Update the CHECK constraint to allow 'receipt' as a message_type
ALTER TABLE direct_messages
  DROP CONSTRAINT IF EXISTS direct_messages_message_type_check;
ALTER TABLE direct_messages
  ADD CONSTRAINT direct_messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'receipt'));

-- 4. Index for fast receipt lookups by order
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_receipt_order
  ON chat_messages (order_id)
  WHERE message_type = 'receipt';

-- 5. Backfill: convert old JSON-string receipt messages to structured format.
--    Old format: content = '{"type":"order_receipt","data":{...}}'
--    New format: message_type = 'receipt', receipt_data = the data object,
--                content = human-readable fallback text.
UPDATE chat_messages
   SET message_type = 'receipt',
       receipt_data = (content::jsonb)->'data',
       content      = COALESCE((content::jsonb)->>'text', 'Order Receipt')
 WHERE message_type = 'text'
   AND content LIKE '{"type":"order_receipt"%'
   AND receipt_data IS NULL;

UPDATE direct_messages
   SET message_type = 'receipt',
       receipt_data = (content::jsonb)->'data',
       content      = COALESCE((content::jsonb)->>'text', 'Order Receipt')
 WHERE message_type = 'text'
   AND content LIKE '{"type":"order_receipt"%'
   AND receipt_data IS NULL;
