-- Migration 064: Enhanced Chat System
-- Adds file support, compliance actor type, presence tracking, message delivery status

-- 1. Add 'compliance' to actor_type enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'compliance'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'actor_type')
  ) THEN
    ALTER TYPE actor_type ADD VALUE 'compliance';
  END IF;
END $$;

-- 2. Add 'file' to message_type enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'file'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'message_type')
  ) THEN
    ALTER TYPE message_type ADD VALUE 'file';
  END IF;
END $$;

-- 3. Add file metadata columns to chat_messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100);

-- 4. Add message delivery status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_status') THEN
    CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'seen');
  END IF;
END $$;

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS status message_status DEFAULT 'sent';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITHOUT TIME ZONE;

-- 5. Add compliance investigation columns
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_highlighted BOOLEAN DEFAULT false;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS highlighted_by UUID;

-- 6. Add chat freeze capability to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chat_frozen BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chat_frozen_at TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chat_frozen_by UUID;

-- 7. Create presence tracking table
CREATE TABLE IF NOT EXISTS chat_presence (
  id UUID DEFAULT public.uuid_generate_v4() NOT NULL PRIMARY KEY,
  actor_type actor_type NOT NULL,
  actor_id UUID NOT NULL,
  is_online BOOLEAN DEFAULT false,
  last_seen TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  connection_id VARCHAR(100),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  UNIQUE(actor_type, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_presence_actor ON chat_presence(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_chat_presence_online ON chat_presence(is_online) WHERE is_online = true;

-- 8. Add file metadata columns to direct_messages too
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100);

-- 9. Index for faster message queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_order_created ON chat_messages(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_highlighted ON chat_messages(order_id, is_highlighted) WHERE is_highlighted = true;

-- 10. Allow content to be nullable (for file-only messages)
ALTER TABLE chat_messages ALTER COLUMN content DROP NOT NULL;
