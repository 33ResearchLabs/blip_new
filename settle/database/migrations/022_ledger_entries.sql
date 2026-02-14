-- Migration 022: Ledger Entries System
-- Unified ledger table for tracking all balance movements

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Account ownership
  account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('merchant', 'user')),
  account_id UUID NOT NULL,

  -- Entry type
  entry_type VARCHAR(30) NOT NULL CHECK (entry_type IN (
    'DEPOSIT',
    'WITHDRAWAL',
    'ESCROW_LOCK',
    'ESCROW_RELEASE',
    'ESCROW_REFUND',
    'FEE',
    'FEE_EARNING',
    'ADJUSTMENT',
    'ORDER_PAYMENT',
    'ORDER_RECEIPT'
  )),

  -- Amount and asset
  amount DECIMAL(20, 8) NOT NULL,
  asset VARCHAR(10) NOT NULL DEFAULT 'USDT',

  -- Reference and metadata
  related_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  related_tx_hash VARCHAR(255),
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Balance snapshot (optional - for audit)
  balance_before DECIMAL(20, 8),
  balance_after DECIMAL(20, 8),

  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account_type, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_order ON ledger_entries(related_order_id) WHERE related_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger_entries(entry_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_created ON ledger_entries(created_at DESC);

-- Function to log ledger entry
CREATE OR REPLACE FUNCTION log_ledger_entry(
  p_account_type VARCHAR,
  p_account_id UUID,
  p_entry_type VARCHAR,
  p_amount DECIMAL,
  p_asset VARCHAR DEFAULT 'USDT',
  p_related_order_id UUID DEFAULT NULL,
  p_related_tx_hash VARCHAR DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
  v_entry_id UUID;
BEGIN
  INSERT INTO ledger_entries (
    account_type,
    account_id,
    entry_type,
    amount,
    asset,
    related_order_id,
    related_tx_hash,
    description,
    metadata
  ) VALUES (
    p_account_type,
    p_account_id,
    p_entry_type,
    p_amount,
    p_asset,
    p_related_order_id,
    p_related_tx_hash,
    p_description,
    p_metadata
  ) RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-log order-related ledger entries
CREATE OR REPLACE FUNCTION auto_log_order_ledger()
RETURNS TRIGGER AS $$
BEGIN
  -- Log escrow lock
  IF NEW.escrow_tx_hash IS NOT NULL AND (OLD.escrow_tx_hash IS NULL OR OLD.escrow_tx_hash != NEW.escrow_tx_hash) THEN
    PERFORM log_ledger_entry(
      'merchant',
      NEW.merchant_id,
      'ESCROW_LOCK',
      -NEW.crypto_amount,
      'USDT',
      NEW.id,
      NEW.escrow_tx_hash,
      'Funds locked in escrow for order #' || NEW.order_number,
      jsonb_build_object('order_type', NEW.type)
    );
  END IF;

  -- Log escrow release/completion
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Release to buyer (user or merchant)
    IF NEW.buyer_merchant_id IS NOT NULL THEN
      -- M2M trade - release to buyer merchant
      PERFORM log_ledger_entry(
        'merchant',
        NEW.buyer_merchant_id,
        'ESCROW_RELEASE',
        NEW.crypto_amount,
        'USDT',
        NEW.id,
        NEW.escrow_tx_hash,
        'Funds received from escrow for order #' || NEW.order_number,
        jsonb_build_object('order_type', NEW.type)
      );
    ELSIF NEW.type = 'buy' AND NEW.buyer_wallet_address IS NOT NULL THEN
      -- Regular buy order - log for user
      PERFORM log_ledger_entry(
        'user',
        NEW.user_id,
        'ESCROW_RELEASE',
        NEW.crypto_amount,
        'USDT',
        NEW.id,
        NEW.escrow_tx_hash,
        'Funds received for order #' || NEW.order_number,
        jsonb_build_object('order_type', NEW.type)
      );
    END IF;

    -- Log platform fee if applicable
    -- Assuming 0.5% platform fee on completed trades
    DECLARE
      v_platform_fee DECIMAL(20, 8);
    BEGIN
      v_platform_fee := NEW.crypto_amount * 0.005;

      -- Deduct from seller
      PERFORM log_ledger_entry(
        'merchant',
        NEW.merchant_id,
        'FEE',
        -v_platform_fee,
        'USDT',
        NEW.id,
        NULL,
        'Platform fee for order #' || NEW.order_number,
        jsonb_build_object('fee_rate', '0.5%', 'order_type', NEW.type)
      );
    END;
  END IF;

  -- Log escrow refund on cancellation
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND NEW.escrow_tx_hash IS NOT NULL THEN
    PERFORM log_ledger_entry(
      'merchant',
      NEW.merchant_id,
      'ESCROW_REFUND',
      NEW.crypto_amount,
      'USDT',
      NEW.id,
      NEW.escrow_tx_hash,
      'Escrow refunded for cancelled order #' || NEW.order_number,
      jsonb_build_object('cancellation_reason', NEW.cancellation_reason)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to orders table
DROP TRIGGER IF EXISTS trigger_auto_log_order_ledger ON orders;
CREATE TRIGGER trigger_auto_log_order_ledger
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION auto_log_order_ledger();

-- View for merchant ledger
CREATE OR REPLACE VIEW v_merchant_ledger AS
SELECT
  le.id,
  le.account_id as merchant_id,
  le.entry_type,
  le.amount,
  le.asset,
  le.related_order_id,
  le.related_tx_hash,
  le.description,
  le.metadata,
  le.created_at,
  o.order_number,
  o.type as order_type,
  o.status as order_status
FROM ledger_entries le
LEFT JOIN orders o ON le.related_order_id = o.id
WHERE le.account_type = 'merchant'
ORDER BY le.created_at DESC;

-- View for user ledger
CREATE OR REPLACE VIEW v_user_ledger AS
SELECT
  le.id,
  le.account_id as user_id,
  le.entry_type,
  le.amount,
  le.asset,
  le.related_order_id,
  le.related_tx_hash,
  le.description,
  le.metadata,
  le.created_at,
  o.order_number,
  o.type as order_type,
  o.status as order_status
FROM ledger_entries le
LEFT JOIN orders o ON le.related_order_id = o.id
WHERE le.account_type = 'user'
ORDER BY le.created_at DESC;
