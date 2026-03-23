-- Migration 040: Add ops page access flag for merchants
-- Allows super admin to grant specific merchants access to the /ops debug page

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS has_ops_access BOOLEAN NOT NULL DEFAULT false;

-- Index for quick lookup when authenticating ops access
CREATE INDEX IF NOT EXISTS idx_merchants_ops_access ON merchants (id) WHERE has_ops_access = true;
