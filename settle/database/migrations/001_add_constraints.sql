-- Migration 001: Add Additional Constraints and Indexes
-- Run after initial schema.sql

-- =====================
-- ADDITIONAL CONSTRAINTS
-- =====================

-- Ensure one dispute per order
ALTER TABLE disputes ADD CONSTRAINT unique_dispute_per_order UNIQUE (order_id);

-- Ensure min_amount <= max_amount on offers
ALTER TABLE merchant_offers ADD CONSTRAINT offers_amount_check CHECK (min_amount <= max_amount);

-- Ensure available_amount >= 0 on offers
ALTER TABLE merchant_offers ADD CONSTRAINT offers_available_positive CHECK (available_amount >= 0);

-- Ensure crypto_amount > 0 on orders
ALTER TABLE orders ADD CONSTRAINT orders_crypto_positive CHECK (crypto_amount > 0);

-- Ensure fiat_amount > 0 on orders
ALTER TABLE orders ADD CONSTRAINT orders_fiat_positive CHECK (fiat_amount > 0);

-- Ensure rate > 0 on orders and offers
ALTER TABLE orders ADD CONSTRAINT orders_rate_positive CHECK (rate > 0);
ALTER TABLE merchant_offers ADD CONSTRAINT offers_rate_positive CHECK (rate > 0);

-- Ensure rating is between 0 and 5
ALTER TABLE users ADD CONSTRAINT users_rating_range CHECK (rating >= 0 AND rating <= 5);
ALTER TABLE merchants ADD CONSTRAINT merchants_rating_range CHECK (rating >= 0 AND rating <= 5);

-- =====================
-- ADDITIONAL INDEXES
-- =====================

-- Index for expiring orders (for cleanup job)
CREATE INDEX IF NOT EXISTS idx_orders_expires_at ON orders(expires_at) WHERE status IN ('pending', 'accepted', 'escrowed', 'payment_sent');

-- Index for disputes by status
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status, created_at);

-- Index for disputes by order
CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(order_id);

-- Index for reviews by order
CREATE INDEX IF NOT EXISTS idx_reviews_order ON reviews(order_id);

-- Index for reviews by reviewee (for calculating ratings)
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_type, reviewee_id);

-- Index for chat messages unread count
CREATE INDEX IF NOT EXISTS idx_messages_unread ON chat_messages(order_id, sender_type, is_read) WHERE is_read = false;

-- Index for user wallet lookup (already unique, but ensuring fast lookup)
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_merchants_wallet ON merchants(wallet_address);

-- Index for merchant offers availability
CREATE INDEX IF NOT EXISTS idx_offers_available ON merchant_offers(merchant_id, is_active, available_amount) WHERE is_active = true;

-- =====================
-- ROW-LEVEL SECURITY (Optional - for future use)
-- =====================

-- Enable RLS on sensitive tables (commented out for now, enable when implementing proper auth)
-- ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- =====================
-- FUNCTIONS FOR DATA INTEGRITY
-- =====================

-- Function to update merchant rating when a new review is added
CREATE OR REPLACE FUNCTION update_merchant_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reviewee_type = 'merchant' THEN
    UPDATE merchants
    SET rating = (
      SELECT ROUND(AVG(rating)::numeric, 1)
      FROM reviews
      WHERE reviewee_type = 'merchant' AND reviewee_id = NEW.reviewee_id
    ),
    rating_count = (
      SELECT COUNT(*)
      FROM reviews
      WHERE reviewee_type = 'merchant' AND reviewee_id = NEW.reviewee_id
    )
    WHERE id = NEW.reviewee_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_merchant_rating
  AFTER INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_merchant_rating();

-- Function to update user rating when a new review is added
CREATE OR REPLACE FUNCTION update_user_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reviewee_type = 'user' THEN
    UPDATE users
    SET rating = (
      SELECT ROUND(AVG(rating)::numeric, 1)
      FROM reviews
      WHERE reviewee_type = 'user' AND reviewee_id = NEW.reviewee_id
    )
    WHERE id = NEW.reviewee_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_rating
  AFTER INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_user_rating();

-- =====================
-- COMMENTS FOR DOCUMENTATION
-- =====================

COMMENT ON TABLE orders IS 'Main orders table - tracks all P2P trades';
COMMENT ON TABLE disputes IS 'Dispute records for contested orders';
COMMENT ON TABLE reviews IS 'User and merchant reviews after completed trades';
COMMENT ON TABLE chat_messages IS 'In-order chat messages between user and merchant';
COMMENT ON TABLE order_events IS 'Audit log of all order status changes';
