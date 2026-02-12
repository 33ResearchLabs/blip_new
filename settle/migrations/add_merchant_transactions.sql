-- Create merchant_transactions table for tracking all balance changes
CREATE TABLE IF NOT EXISTS merchant_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL,
  amount DECIMAL(18, 6) NOT NULL, -- Positive for credit, negative for debit
  balance_before DECIMAL(18, 6) NOT NULL DEFAULT 0,
  balance_after DECIMAL(18, 6) NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure either merchant_id or user_id is set
  CONSTRAINT check_merchant_or_user CHECK (
    (merchant_id IS NOT NULL AND user_id IS NULL) OR
    (merchant_id IS NULL AND user_id IS NOT NULL)
  )
);

-- Indexes for fast lookups
CREATE INDEX idx_merchant_transactions_merchant_id ON merchant_transactions(merchant_id);
CREATE INDEX idx_merchant_transactions_user_id ON merchant_transactions(user_id);
CREATE INDEX idx_merchant_transactions_order_id ON merchant_transactions(order_id);
CREATE INDEX idx_merchant_transactions_created_at ON merchant_transactions(created_at DESC);
CREATE INDEX idx_merchant_transactions_type ON merchant_transactions(type);

-- Comments
COMMENT ON TABLE merchant_transactions IS 'Audit log of all balance changes for merchants and users';
COMMENT ON COLUMN merchant_transactions.amount IS 'Positive for credits (money in), negative for debits (money out)';
COMMENT ON COLUMN merchant_transactions.type IS 'Type: escrow_lock, escrow_release, escrow_refund, order_completed, order_cancelled, manual_adjustment';
