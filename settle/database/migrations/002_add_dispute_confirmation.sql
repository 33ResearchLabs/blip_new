-- Migration 002: Add 2-Confirmation Flow to Disputes
-- This adds columns needed for the dispute resolution confirmation workflow

-- =====================
-- UPDATE DISPUTE STATUS ENUM
-- =====================

-- Add new status values for the 2-confirmation flow
ALTER TYPE dispute_status ADD VALUE IF NOT EXISTS 'pending_confirmation';
ALTER TYPE dispute_status ADD VALUE IF NOT EXISTS 'resolved_user';
ALTER TYPE dispute_status ADD VALUE IF NOT EXISTS 'resolved_merchant';
ALTER TYPE dispute_status ADD VALUE IF NOT EXISTS 'resolved_split';

-- =====================
-- ADD CONFIRMATION COLUMNS TO DISPUTES
-- =====================

-- Proposed resolution (set by compliance)
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS proposed_resolution VARCHAR(50);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS proposed_by UUID;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ;

-- 2-confirmation tracking
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS user_confirmed BOOLEAN DEFAULT false;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS merchant_confirmed BOOLEAN DEFAULT false;

-- Additional resolution details
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS split_percentage JSONB;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS assigned_to UUID;

-- =====================
-- UPDATE MESSAGE TYPE ENUM
-- =====================

-- Add new message types for dispute-related messages
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'dispute';
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'resolution';
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'resolution_proposed';
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'resolution_rejected';
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'resolution_accepted';
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'resolution_finalized';

-- =====================
-- CREATE MESSAGES TABLE (alias for chat_messages)
-- =====================

-- Create a view called 'messages' that points to chat_messages for compatibility
CREATE OR REPLACE VIEW messages AS SELECT * FROM chat_messages;

-- Create a rule to allow inserts via the view
CREATE OR REPLACE RULE messages_insert AS ON INSERT TO messages
DO INSTEAD INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, image_url, is_read, created_at)
VALUES (NEW.order_id, NEW.sender_type, NEW.sender_id, NEW.content, NEW.message_type, NEW.image_url, COALESCE(NEW.is_read, false), COALESCE(NEW.created_at, NOW()))
RETURNING *;

-- Create a rule to allow updates via the view
CREATE OR REPLACE RULE messages_update AS ON UPDATE TO messages
DO INSTEAD UPDATE chat_messages SET
  is_read = NEW.is_read,
  read_at = NEW.read_at
WHERE id = OLD.id;

-- =====================
-- COMPLIANCE TEAM TABLE
-- =====================

CREATE TABLE IF NOT EXISTS compliance_team (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'support',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default compliance members
INSERT INTO compliance_team (email, name, role)
VALUES
  ('support@settle.com', 'Support Agent', 'support'),
  ('compliance@settle.com', 'Compliance Officer', 'compliance'),
  ('admin@settle.com', 'Admin', 'admin')
ON CONFLICT (email) DO NOTHING;

-- =====================
-- ORDER STATUS HISTORY TABLE (optional)
-- =====================

CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  previous_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,
  actor_type VARCHAR(50),
  actor_id VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id, created_at);

-- =====================
-- COMMENTS
-- =====================

COMMENT ON COLUMN disputes.proposed_resolution IS 'Resolution proposed by compliance: user, merchant, or split';
COMMENT ON COLUMN disputes.user_confirmed IS 'Whether user has confirmed the proposed resolution';
COMMENT ON COLUMN disputes.merchant_confirmed IS 'Whether merchant has confirmed the proposed resolution';
COMMENT ON COLUMN disputes.split_percentage IS 'JSON with user and merchant percentages for split resolutions';
