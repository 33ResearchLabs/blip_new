-- Migration 090: Add telegram_chat_id column to merchants
--
-- Already declared in settle/database/schema.sql line 1379, and read by
-- apps/core-api/src/workers/notificationOutbox.ts (SELECT telegram_chat_id
-- FROM merchants ...) and POST/GET /api/merchant/[id]/telegram routes.
--
-- The column was missing from the migration history, causing 42703
-- "column does not exist" errors whenever the notification worker tried
-- to dispatch a Telegram notification for a merchant.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

COMMENT ON COLUMN merchants.telegram_chat_id IS
  'Telegram chat ID for sending order notifications via the Telegram bot. NULL when merchant has not connected Telegram.';
