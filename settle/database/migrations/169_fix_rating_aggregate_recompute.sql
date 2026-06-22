-- Migration 169: Fix rating aggregate drift that 500s rating submission
--
-- BUG: update_aggregate_rating() (AFTER INSERT ON ratings) maintained
-- merchants/users.total_rating_sum, rating_count and rating by INCREMENTING:
--   rating = ROUND((old_sum + NEW.rating) / (old_count + 1), 1)
-- That counter has no self-correction. Once total_rating_sum drifted out of
-- sync with the real ratings rows (e.g. a seeded/manual value, or a rating row
-- deleted after the trigger had counted it — the trigger only fires on INSERT),
-- every later rating inherited the drift. When old_sum/old_count implied an
-- average > 5, a new rating computed e.g. (66+5)/(13+1)=5.07 -> 5.1, which
-- violates the merchants_rating_range / users_rating_range CHECK (rating <= 5).
-- The failing INSERT aborts inside createRating(), the /api/ratings POST catch
-- only special-cases "duplicate key", so the user got a bare HTTP 500 and the
-- rating could never be submitted.
--
-- FIX (idempotent):
--   1. Rewrite the trigger to RECOMPUTE the aggregates from the authoritative
--      `ratings` table on every insert. Since it is an AFTER INSERT trigger the
--      new row is already present, and every rating is CHECK-constrained to
--      1..5, so the average is always <= 5 — the range CHECK can never be
--      tripped again and the counters can never drift.
--   2. Backfill the corrupted aggregates from `ratings` for every entity that
--      has at least one ratings row (heals the drifted merchant; safe no-op for
--      already-consistent rows). Entities with no ratings rows are left
--      untouched so review-only data (from /api/orders/[id]/review -> reviews)
--      is not clobbered.

-- 1. Self-healing trigger: derive count/sum/avg from the ratings table.
CREATE OR REPLACE FUNCTION update_aggregate_rating()
RETURNS TRIGGER AS $$
DECLARE
  agg_count INTEGER;
  agg_sum   INTEGER;
  agg_avg   NUMERIC;
BEGIN
  -- Authoritative recompute from the ratings rows (the new row is already
  -- visible — this trigger fires AFTER INSERT).
  SELECT COUNT(*), COALESCE(SUM(rating), 0)
    INTO agg_count, agg_sum
    FROM ratings
   WHERE rated_type = NEW.rated_type
     AND rated_id   = NEW.rated_id;

  -- AVG of values in [1,5] is always in [1,5]; 0 when there are no ratings.
  agg_avg := CASE WHEN agg_count > 0
                  THEN ROUND(agg_sum::NUMERIC / agg_count, 1)
                  ELSE 0 END;

  IF NEW.rated_type = 'user' THEN
    UPDATE users
       SET total_rating_sum = agg_sum,
           rating_count     = agg_count,
           rating           = agg_avg
     WHERE id = NEW.rated_id;
  ELSIF NEW.rated_type = 'merchant' THEN
    UPDATE merchants
       SET total_rating_sum = agg_sum,
           rating_count     = agg_count,
           rating           = agg_avg
     WHERE id = NEW.rated_id;
  END IF;

  -- Order-level rating columns (unchanged behaviour).
  IF NEW.rater_type = 'merchant' THEN
    UPDATE orders
       SET merchant_rating = NEW.rating, merchant_rated_at = NEW.created_at
     WHERE id = NEW.order_id;
  ELSIF NEW.rater_type = 'user' THEN
    UPDATE orders
       SET user_rating = NEW.rating, user_rated_at = NEW.created_at
     WHERE id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_aggregate_rating ON ratings;
CREATE TRIGGER trigger_update_aggregate_rating
  AFTER INSERT ON ratings
  FOR EACH ROW
  EXECUTE FUNCTION update_aggregate_rating();

-- 2. Backfill drifted aggregates from the authoritative ratings rows.
--    Only touches entities that actually have ratings rows.
UPDATE merchants m
   SET rating_count     = agg.cnt,
       total_rating_sum = agg.sm,
       rating           = ROUND(agg.sm::NUMERIC / NULLIF(agg.cnt, 0), 1)
  FROM (
    SELECT rated_id, COUNT(*) AS cnt, COALESCE(SUM(rating), 0) AS sm
      FROM ratings
     WHERE rated_type = 'merchant'
     GROUP BY rated_id
  ) agg
 WHERE m.id = agg.rated_id
   AND (m.rating_count IS DISTINCT FROM agg.cnt
        OR m.total_rating_sum IS DISTINCT FROM agg.sm
        OR m.rating IS DISTINCT FROM ROUND(agg.sm::NUMERIC / NULLIF(agg.cnt, 0), 1));

UPDATE users u
   SET rating_count     = agg.cnt,
       total_rating_sum = agg.sm,
       rating           = ROUND(agg.sm::NUMERIC / NULLIF(agg.cnt, 0), 1)
  FROM (
    SELECT rated_id, COUNT(*) AS cnt, COALESCE(SUM(rating), 0) AS sm
      FROM ratings
     WHERE rated_type = 'user'
     GROUP BY rated_id
  ) agg
 WHERE u.id = agg.rated_id
   AND (u.rating_count IS DISTINCT FROM agg.cnt
        OR u.total_rating_sum IS DISTINCT FROM agg.sm
        OR u.rating IS DISTINCT FROM ROUND(agg.sm::NUMERIC / NULLIF(agg.cnt, 0), 1));
