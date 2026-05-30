-- Add buy_rate and sell_rate columns to merchants table for INR corridor rates.
-- Both are nullable — merchants not operating in the India corridor leave them null.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS buy_rate  NUMERIC(10, 4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sell_rate NUMERIC(10, 4) DEFAULT NULL;
