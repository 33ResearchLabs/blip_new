-- Add optional screenshot URL to error_logs.
-- PURELY ADDITIVE: only attaches a new nullable column — all existing rows
-- and existing queries continue to work unchanged.
--
-- Populated by the client-side error reporter (html2canvas → Cloudinary)
-- for UI_CRASH and CRITICAL-severity events only. Backend / worker rows
-- never carry screenshots so this column will be NULL for the majority of
-- entries.

ALTER TABLE error_logs
  ADD COLUMN IF NOT EXISTS screenshot_url TEXT;

-- Partial index — only rows that actually have a screenshot get indexed so
-- the admin dashboard can quickly surface "has screenshot" filters without
-- bloating the main index.
CREATE INDEX IF NOT EXISTS idx_error_logs_screenshot
  ON error_logs (created_at DESC)
  WHERE screenshot_url IS NOT NULL;
