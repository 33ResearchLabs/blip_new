-- Wipe all indexed data so blipscan starts fresh against mainnet.
-- DESTRUCTIVE: drops every indexed row. Schema stays intact.
--
-- Usage (production, once mainnet env vars are deployed):
--   psql "$DATABASE_URL" -f database/wipe.sql
--
-- Then restart the indexer; it will repopulate from current mainnet
-- signatures (cursors are reset, so backfill begins from latest).

BEGIN;

DO $$
DECLARE
  tbl TEXT;
  -- All tables the indexer writes to. Missing tables are skipped (older
  -- deploys may not have lane_operations / reputation_scores).
  tables TEXT[] := ARRAY[
    'trades',
    'v2_trades',
    'trade_events',
    'transactions',
    'lane_operations',
    'merchant_stats',
    'reputation_scores',
    'indexer_cursor'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', tbl);
      RAISE NOTICE 'Truncated %', tbl;
    ELSE
      RAISE NOTICE 'Skipped (no such table): %', tbl;
    END IF;
  END LOOP;
END $$;

COMMIT;
