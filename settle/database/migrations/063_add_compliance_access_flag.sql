-- Migration 063: Add has_compliance_access flag to merchants
-- Allows admin to grant compliance portal access to specific merchants

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS has_compliance_access BOOLEAN DEFAULT false;
