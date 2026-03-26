-- 041b: Use the 'receipt' enum value added in 041.
-- This MUST run in a separate transaction after 041 commits the new enum value.

-- 1. Update CHECK constraint on direct_messages to allow 'receipt'
ALTER TABLE direct_messages
  DROP CONSTRAINT IF EXISTS direct_messages_message_type_check;
ALTER TABLE direct_messages
  ADD CONSTRAINT direct_messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'receipt'));

-- 2. Index for fast receipt lookups by order
CREATE INDEX IF NOT EXISTS idx_chat_messages_receipt_order
  ON chat_messages (order_id)
  WHERE message_type = 'receipt';

-- 3. Backfill: convert old JSON-string receipt messages to structured format.
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
