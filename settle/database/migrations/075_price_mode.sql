-- Migration: Price config with LIVE/MANUAL mode toggle
-- Admin can switch between live API price and manual admin-set price.

CREATE TABLE IF NOT EXISTS price_config (
  key           VARCHAR(50) PRIMARY KEY,
  avg_price     DECIMAL(20, 4),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    VARCHAR(100)
);

ALTER TABLE price_config
  ADD COLUMN IF NOT EXISTS price_mode VARCHAR(10) NOT NULL DEFAULT 'LIVE',
  ADD COLUMN IF NOT EXISTS admin_price DECIMAL(20, 6);

-- Ensure both pairs exist
INSERT INTO price_config (key) VALUES ('usdt_inr') ON CONFLICT (key) DO NOTHING;
INSERT INTO price_config (key) VALUES ('usdt_aed') ON CONFLICT (key) DO NOTHING;
