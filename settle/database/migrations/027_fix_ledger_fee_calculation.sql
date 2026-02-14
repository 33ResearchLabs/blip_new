-- Migration 027: Fix ledger trigger to use order's protocol_fee_percentage
-- instead of hardcoded 0.5%, and use escrow_debited_* fields for account targeting.

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
        )
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
      jsonb_build_object('cancellation_reason', NEW.cancellation_reason)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
