-- Migration 014: Direct Messaging System
-- Adds contacts and direct messages tables for WhatsApp-style chat

-- Merchant contacts (auto-populated from completed trades)
CREATE TABLE IF NOT EXISTS merchant_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname VARCHAR(100), -- Optional custom name for the contact
  notes TEXT, -- Private notes about the contact
  is_favorite BOOLEAN DEFAULT false,
  trades_count INT DEFAULT 1, -- Number of completed trades with this user
  total_volume DECIMAL(20, 2) DEFAULT 0, -- Total trade volume
  last_trade_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(merchant_id, user_id)
);

CREATE INDEX idx_merchant_contacts_merchant ON merchant_contacts(merchant_id);
CREATE INDEX idx_merchant_contacts_user ON merchant_contacts(user_id);

-- Direct messages (not tied to orders)
CREATE TABLE IF NOT EXISTS direct_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('merchant', 'user')),
  sender_id UUID NOT NULL,
  recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('merchant', 'user')),
  recipient_id UUID NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image')),
  image_url TEXT,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fetching conversation between two parties
CREATE INDEX idx_direct_messages_conversation ON direct_messages(
  LEAST(sender_id, recipient_id),
  GREATEST(sender_id, recipient_id),
  created_at DESC
);

-- Index for fetching messages for a specific user/merchant
CREATE INDEX idx_direct_messages_sender ON direct_messages(sender_id, sender_type, created_at DESC);
CREATE INDEX idx_direct_messages_recipient ON direct_messages(recipient_id, recipient_type, created_at DESC);
CREATE INDEX idx_direct_messages_unread ON direct_messages(recipient_id, recipient_type, is_read) WHERE is_read = false;
