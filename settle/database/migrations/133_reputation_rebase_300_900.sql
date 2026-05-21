-- ============================================================================
-- 133_reputation_rebase_300_900.sql
--
-- One-time rescale of reputation_scores from the legacy 0–1000 range to
-- the CIBIL-style 300–900 range introduced by Phase 4 of the coins +
-- reputation merge.
--
-- Formula: new = round(300 + (old / 1000) * 600)
-- Clamped to [300, 900].
--
-- Re-runnable: a row that's already in 300–900 range is treated as already
-- rebased and skipped. We detect this by checking total_score < 200 OR > 900
-- vs the rebased range. A more bulletproof signal would be a boolean flag,
-- but adding a column for a one-time migration is over-engineered.
--
-- The same formula is applied to:
--   - reputation_scores.total_score (current value)
--   - reputation_history.total_score (historical timeseries)
-- Component sub-scores (review/execution/volume/consistency/trust) stay
-- in their original 0–100ish ranges — those are internal-only.
-- ============================================================================

DO $$
BEGIN
  -- Guard: only rescale if there's at least one row that LOOKS unrescaled
  -- (>900 OR <300 wouldn't fit the new scale). If everything's already
  -- in [300, 900], skip.
  IF EXISTS (
    SELECT 1 FROM reputation_scores
    WHERE total_score < 300 OR total_score > 900
    LIMIT 1
  ) THEN
    UPDATE reputation_scores
       SET total_score = LEAST(900, GREATEST(300,
            ROUND(300 + (total_score::numeric / 1000.0) * 600.0)::int)),
           updated_at = NOW()
     WHERE total_score < 300 OR total_score > 900;
  END IF;

  IF EXISTS (
    SELECT 1 FROM reputation_history
    WHERE total_score < 300 OR total_score > 900
    LIMIT 1
  ) THEN
    UPDATE reputation_history
       SET total_score = LEAST(900, GREATEST(300,
            ROUND(300 + (total_score::numeric / 1000.0) * 600.0)::int))
     WHERE total_score < 300 OR total_score > 900;
  END IF;
END$$;

-- Seed default for any users/merchants with NO reputation row yet — they
-- start at 500 (the "New" tier base). We don't pre-populate every row
-- because the daily worker / event-driven recomputes handle that lazily.
-- This guard just makes sure that any actor read BEFORE their first
-- recompute sees the 500 default instead of NULL → undefined behaviour
-- downstream.
INSERT INTO reputation_scores
  (entity_id, entity_type, total_score, review_score, execution_score,
   volume_score, consistency_score, trust_score, tier, badges,
   calculated_at, created_at, updated_at)
SELECT u.id, 'user', 500, 50, 0, 0, 0, 50, 'newcomer', ARRAY[]::text[],
       NOW(), NOW(), NOW()
  FROM users u
  LEFT JOIN reputation_scores r
    ON r.entity_id = u.id AND r.entity_type = 'user'
 WHERE r.entity_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO reputation_scores
  (entity_id, entity_type, total_score, review_score, execution_score,
   volume_score, consistency_score, trust_score, tier, badges,
   calculated_at, created_at, updated_at)
SELECT m.id, 'merchant', 500, 50, 0, 0, 0, 50, 'newcomer', ARRAY[]::text[],
       NOW(), NOW(), NOW()
  FROM merchants m
  LEFT JOIN reputation_scores r
    ON r.entity_id = m.id AND r.entity_type = 'merchant'
 WHERE r.entity_id IS NULL
ON CONFLICT DO NOTHING;
