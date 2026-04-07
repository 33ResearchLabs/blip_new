-- Migration: USDT price tick system (multi-pair)
-- Worker stores a tick every 25s; API computes avg from ticks over timeframe.

-- Price ticks — one row per fetch per pair
CREATE TABLE IF NOT EXISTS price_ticks (
  id            BIGSERIAL PRIMARY KEY,
  pair          VARCHAR(50) NOT NULL,       -- 'usdt_inr', 'usdt_aed'
  price         DECIMAL(20, 6) NOT NULL,
  source        VARCHAR(20) NOT NULL,       -- 'coingecko' | 'binance'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookups: recent ticks per pair (used by avg + chart queries)
CREATE INDEX IF NOT EXISTS idx_price_ticks_pair_created
  ON price_ticks (pair, created_at DESC);

-- Cleanup index: DELETE WHERE created_at < threshold
CREATE INDEX IF NOT EXISTS idx_price_ticks_created
  ON price_ticks (created_at);


