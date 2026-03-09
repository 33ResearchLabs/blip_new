-- Migration 037: Ledger Entry Idempotency Key
--
-- Adds idempotency_key column to ledger_entries with a partial unique index.
-- Prevents duplicate ledger entries even if a handler executes twice.
-- Complements request-level idempotency (LOCK #3).

-- 1. Add column
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- 2. Backfill existing rows with unique deterministic values
UPDATE ledger_entries SET idempotency_key = 'legacy:' || id::text WHERE idempotency_key IS NULL;

-- 3. Partial unique index (NULLs don't conflict, non-NULL must be unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_idempotency
  ON ledger_entries(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 4. Replace log_ledger_entry() to accept optional idempotency_key (10th param)
--    Uses ON CONFLICT DO NOTHING so duplicate keys are silently ignored.
CREATE OR REPLACE FUNCTION log_ledger_entry(
  p_account_type VARCHAR,
  p_account_id UUID,
  p_entry_type VARCHAR,
  p_amount DECIMAL,
  p_asset VARCHAR DEFAULT 'USDT',
  p_related_order_id UUID DEFAULT NULL,
  p_related_tx_hash VARCHAR DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_idempotency_key TEXT DEFAULT NULL
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
    metadata,
    idempotency_key
  ) VALUES (
    p_account_type,
    p_account_id,
    p_entry_type,
    p_amount,
    p_asset,
    p_related_order_id,
    p_related_tx_hash,
    p_description,
    p_metadata,
    p_idempotency_key
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql;

-- 5. Replace auto_log_order_ledger() trigger to pass deterministic keys.
--    Based on migration 027 version (uses escrow_debited_entity_* + protocol_fee_percentage).
CREATE OR REPLACE FUNCTION auto_log_order_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_account_type VARCHAR(20);
  v_account_id UUID;
BEGIN
  -- Determine the escrow payer account (prefer recorded fields, fallback to merchant_id)
  v_account_type := COALESCE(NEW.escrow_debited_entity_type, 'merchant');
  v_account_id := COALESCE(NEW.escrow_debited_entity_id, NEW.merchant_id);

  -- Log escrow lock (when escrow_tx_hash is first set)
  IF NEW.escrow_tx_hash IS NOT NULL AND (OLD.escrow_tx_hash IS NULL OR OLD.escrow_tx_hash != NEW.escrow_tx_hash) THEN
    PERFORM log_ledger_entry(
      v_account_type,
      v_account_id,
      'ESCROW_LOCK',
      -NEW.crypto_amount,
      'USDT',
      NEW.id,
      NEW.escrow_tx_hash,
      'Funds locked in escrow for order #' || NEW.order_number,
      jsonb_build_object('order_type', NEW.type),
      NEW.id || ':ESCROW_LOCK'
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
        jsonb_build_object('order_type', NEW.type),
        NEW.id || ':ESCROW_RELEASE'
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
        jsonb_build_object('order_type', NEW.type),
        NEW.id || ':ESCROW_RELEASE'
      );
    END IF;

    -- Log platform fee using order's protocol_fee_percentage (not hardcoded 0.5%)
    DECLARE
      v_fee_rate DECIMAL(5,4);
      v_platform_fee DECIMAL(20, 8);
    BEGIN
      v_fee_rate := COALESCE(NEW.protocol_fee_percentage, 2.50) / 100.0;
      v_platform_fee := NEW.crypto_amount * v_fee_rate;

      -- Deduct fee from the escrow payer (seller)
      PERFORM log_ledger_entry(
        v_account_type,
        v_account_id,
        'FEE',
        -v_platform_fee,
        'USDT',
        NEW.id,
        NULL,
        'Platform fee for order #' || NEW.order_number,
        jsonb_build_object(
          'fee_rate', (COALESCE(NEW.protocol_fee_percentage, 2.50) || '%'),
          'order_type', NEW.type,
          'spread_preference', COALESCE(NEW.spread_preference, 'fastest')
        ),
        NEW.id || ':FEE'
      );
    END;
  END IF;

  -- Log escrow refund on cancellation
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND NEW.escrow_tx_hash IS NOT NULL THEN
    PERFORM log_ledger_entry(
      v_account_type,
      v_account_id,
      'ESCROW_REFUND',
      NEW.crypto_amount,
      'USDT',
      NEW.id,
      NEW.escrow_tx_hash,
      'Escrow refunded for cancelled order #' || NEW.order_number,
      jsonb_build_object('cancellation_reason', NEW.cancellation_reason),
      NEW.id || ':ESCROW_REFUND'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
