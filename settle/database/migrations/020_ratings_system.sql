-- Migration 020: Ratings System
-- Adds mutual rating functionality for completed orders

-- Ratings table to store individual ratings
CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  -- Who is giving the rating
  rater_type VARCHAR(20) NOT NULL CHECK (rater_type IN ('merchant', 'user')),
  rater_id UUID NOT NULL,

  -- Who is being rated
  rated_type VARCHAR(20) NOT NULL CHECK (rated_type IN ('merchant', 'user')),
  rated_id UUID NOT NULL,

  -- Rating details
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,

  created_at TIMESTAMP DEFAULT NOW(),

  -- Ensure each party can only rate once per order
  UNIQUE(order_id, rater_type, rater_id)
);

-- Indexes for efficient queries
CREATE INDEX idx_ratings_order ON ratings(order_id);
CREATE INDEX idx_ratings_rated ON ratings(rated_type, rated_id, created_at DESC);
CREATE INDEX idx_ratings_rater ON ratings(rater_type, rater_id, created_at DESC);

-- Add rating tracking columns to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS merchant_rated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS user_rated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS merchant_rating INTEGER CHECK (merchant_rating >= 1 AND merchant_rating <= 5),
  ADD COLUMN IF NOT EXISTS user_rating INTEGER CHECK (user_rating >= 1 AND user_rating <= 5);

-- Add aggregate rating columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_rating_sum INTEGER DEFAULT 0;

-- Add aggregate rating columns to merchants table (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchants' AND column_name = 'rating_count'
  ) THEN
    ALTER TABLE merchants ADD COLUMN rating_count INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchants' AND column_name = 'total_rating_sum'
  ) THEN
    ALTER TABLE merchants ADD COLUMN total_rating_sum INTEGER DEFAULT 0;
  END IF;
END $$;

-- Function to update aggregate ratings when a new rating is added
CREATE OR REPLACE FUNCTION update_aggregate_rating()
RETURNS TRIGGER AS $$
BEGIN
  -- Update user aggregate rating
  IF NEW.rated_type = 'user' THEN
    UPDATE users
    SET
      total_rating_sum = COALESCE(total_rating_sum, 0) + NEW.rating,
      rating_count = COALESCE(rating_count, 0) + 1,
      rating = ROUND((COALESCE(total_rating_sum, 0) + NEW.rating)::DECIMAL / (COALESCE(rating_count, 0) + 1), 2)
    WHERE id = NEW.rated_id;
  END IF;

  -- Update merchant aggregate rating
  IF NEW.rated_type = 'merchant' THEN
    UPDATE merchants
    SET
      total_rating_sum = COALESCE(total_rating_sum, 0) + NEW.rating,
      rating_count = COALESCE(rating_count, 0) + 1,
      rating = ROUND((COALESCE(total_rating_sum, 0) + NEW.rating)::DECIMAL / (COALESCE(rating_count, 0) + 1), 2)
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

-- Trigger to update aggregate ratings
DROP TRIGGER IF EXISTS trigger_update_aggregate_rating ON ratings;
CREATE TRIGGER trigger_update_aggregate_rating
  AFTER INSERT ON ratings
  FOR EACH ROW
  EXECUTE FUNCTION update_aggregate_rating();

-- View for top rated sellers (merchants)
CREATE OR REPLACE VIEW v_top_rated_sellers AS
SELECT
  m.id,
  m.username,
  m.display_name,
  m.rating,
  m.rating_count,
  m.total_trades,
  m.wallet_address,
  m.created_at,
  RANK() OVER (ORDER BY m.rating DESC, m.rating_count DESC) as rank
FROM merchants m
WHERE m.status = 'active'
  AND m.rating_count >= 3  -- Minimum 3 ratings to appear
ORDER BY m.rating DESC, m.rating_count DESC
LIMIT 10;

-- View for top rated users
CREATE OR REPLACE VIEW v_top_rated_users AS
SELECT
  u.id,
  u.username,
  u.rating,
  u.rating_count,
  u.total_trades,
  u.wallet_address,
  u.created_at,
  RANK() OVER (ORDER BY u.rating DESC, u.rating_count DESC) as rank
FROM users u
WHERE u.rating_count >= 3  -- Minimum 3 ratings to appear
ORDER BY u.rating DESC, u.rating_count DESC
LIMIT 10;
