-- Migration 016: Add compliance to actor_type enum for order chat access
-- This allows compliance team members to participate in order chats

-- Step 1: Add 'compliance' value to the actor_type enum
-- PostgreSQL allows adding values to existing enums
ALTER TYPE actor_type ADD VALUE IF NOT EXISTS 'compliance';

-- Step 2: Add index for efficient compliance message queries
CREATE INDEX IF NOT EXISTS idx_messages_compliance
ON chat_messages(sender_type, created_at)
WHERE sender_type = 'compliance';

-- Step 3: Add assigned_compliance_id to orders for tracking which compliance officer is assigned
-- This links an order to a compliance team member for chat access
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_compliance_id UUID REFERENCES compliance_team(id);

-- Step 4: Create index for efficient compliance order lookups
CREATE INDEX IF NOT EXISTS idx_orders_compliance
ON orders(assigned_compliance_id)
WHERE assigned_compliance_id IS NOT NULL;

-- Note: Compliance team members can access orders when:
-- 1. They are assigned to the order (assigned_compliance_id)
-- 2. The order has an active dispute assigned to them
-- 3. They have 'can_view_all_orders' permission (admin-level)
