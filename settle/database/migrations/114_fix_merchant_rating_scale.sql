-- Fix: update_aggregate_rating() overflowed merchants.rating on every insert.
--
-- merchants.rating is NUMERIC(2,1) (scale 1) but the trigger rounded to scale 2,
-- which Postgres rejects with code 22003 ("numeric field overflow"). Change the
-- merchants branch to ROUND(..., 1); the users branch stays at ROUND(..., 2)
-- because users.rating is DECIMAL(3,2).

CREATE OR REPLACE FUNCTION update_aggregate_rating()
RETURNS TRIGGER AS $$
BEGIN
  -- Update user aggregate rating (column type DECIMAL(3,2) — scale 2)
  IF NEW.rated_type = 'user' THEN
    UPDATE users
    SET
      total_rating_sum = COALESCE(total_rating_sum, 0) + NEW.rating,
      rating_count = COALESCE(rating_count, 0) + 1,
      rating = ROUND((COALESCE(total_rating_sum, 0) + NEW.rating)::DECIMAL / (COALESCE(rating_count, 0) + 1), 2)
    WHERE id = NEW.rated_id;
  END IF;

  -- Update merchant aggregate rating (column type NUMERIC(2,1) — scale 1)
  IF NEW.rated_type = 'merchant' THEN
    UPDATE merchants
    SET
      total_rating_sum = COALESCE(total_rating_sum, 0) + NEW.rating,
      rating_count = COALESCE(rating_count, 0) + 1,
      rating = ROUND((COALESCE(total_rating_sum, 0) + NEW.rating)::DECIMAL / (COALESCE(rating_count, 0) + 1), 1)
    WHERE id = NEW.rated_id;
  END IF;

  -- Update order rating columns
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
