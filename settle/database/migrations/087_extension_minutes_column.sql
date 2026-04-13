-- 087: Add missing extension_minutes column to orders table
--
-- The extension route (core-api/routes/extension.ts) writes to this column
-- but it was never created in any migration. This causes PostgreSQL error
-- 42703 ("undefined column") when a user requests a time extension.
--
-- Column stores the duration (in minutes) of the requested extension.
-- For payment_sent orders, the fiat sender picks from [15, 60, 720].
-- For other statuses, getExtensionDuration() computes a default.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS extension_minutes INT DEFAULT NULL;

COMMENT ON COLUMN orders.extension_minutes
  IS 'Duration in minutes of the current pending extension request';
