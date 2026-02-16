-- Migration 019: M2M Contact Support
-- Allow merchant_contacts to store merchant-to-merchant contacts

-- Add contact_merchant_id column (nullable, for M2M contacts)
ALTER TABLE merchant_contacts
  ADD COLUMN IF NOT EXISTS contact_merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE;

-- Add contact_type to distinguish user vs merchant contacts
ALTER TABLE merchant_contacts
  ADD COLUMN IF NOT EXISTS contact_type VARCHAR(20) DEFAULT 'user';

-- Backfill existing rows as 'user' type
UPDATE merchant_contacts SET contact_type = 'user' WHERE contact_type IS NULL;

-- Make user_id nullable (M2M contacts have contact_merchant_id instead)
ALTER TABLE merchant_contacts ALTER COLUMN user_id DROP NOT NULL;

-- Add unique index for merchant-to-merchant contacts
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_contacts_m2m
  ON merchant_contacts(merchant_id, contact_merchant_id)
  WHERE contact_merchant_id IS NOT NULL;

-- Index for lookups by contact_merchant_id
CREATE INDEX IF NOT EXISTS idx_merchant_contacts_contact_merchant
  ON merchant_contacts(contact_merchant_id);
