-- Add 'receipt' to the message_type enum and add a receipt_data JSONB column
-- so receipt messages are stored as structured data instead of JSON strings in content.
--
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot be used in the same transaction
-- as statements that reference the new value. PostgreSQL requires a COMMIT
-- between adding an enum value and using it (error 55P04).
--
-- Strategy: This migration ONLY adds the enum value and the columns.
-- The CHECK constraint, index filter, and backfill that reference 'receipt'
-- are deferred to migration 041b which runs in a separate transaction.

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

-- 3. Add receipt_data column to direct_messages
ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS receipt_data jsonb;
