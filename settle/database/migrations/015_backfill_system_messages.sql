-- Migration: Backfill system messages for existing orders
-- This adds timeline messages to chat history for orders that were created before system messages were implemented

-- Insert system messages for each order event in history
INSERT INTO chat_messages (id, order_id, sender_type, sender_id, content, message_type, created_at)
SELECT
  uuid_generate_v4(),
  oe.order_id,
  'system'::actor_type,
  oe.order_id::text,
  CASE oe.new_status
    WHEN 'pending' THEN '📝 Order created'
    WHEN 'accepted' THEN '✅ Order accepted by merchant'
    WHEN 'escrow_pending' THEN '⏳ Waiting for escrow deposit...'
    WHEN 'escrowed' THEN '🔒 Escrow locked - funds secured on-chain'
    WHEN 'payment_pending' THEN '⏳ Waiting for payment...'
    WHEN 'payment_sent' THEN '💸 Payment sent - waiting for confirmation'
    WHEN 'payment_confirmed' THEN '✅ Payment confirmed'
    WHEN 'releasing' THEN '⏳ Releasing escrow...'
    WHEN 'completed' THEN '🎉 Trade completed successfully!'
    WHEN 'cancelled' THEN '❌ Order cancelled'
    WHEN 'disputed' THEN '⚠️ Dispute opened'
    WHEN 'expired' THEN '⏰ Order expired'
    ELSE NULL
  END,
  'system'::message_type,
  oe.created_at
FROM order_events oe
WHERE oe.new_status IS NOT NULL
  AND oe.event_type IN ('status_change', 'created', 'accepted', 'escrowed', 'completed', 'cancelled', 'disputed', 'expired')
  -- Don't insert duplicates - check if system message for this status already exists
  AND NOT EXISTS (
    SELECT 1 FROM chat_messages cm
    WHERE cm.order_id = oe.order_id
      AND cm.sender_type = 'system'
      AND cm.message_type = 'system'
      AND cm.created_at = oe.created_at
  )
ORDER BY oe.order_id, oe.created_at;

-- Also add creation messages for orders that don't have any system messages yet
-- Use the order's created_at timestamp
INSERT INTO chat_messages (id, order_id, sender_type, sender_id, content, message_type, created_at)
SELECT
  uuid_generate_v4(),
  o.id,
  'system'::actor_type,
  o.id::text,
  'Order #' || o.order_number || ' created for ' || o.crypto_amount || ' ' || o.crypto_currency,
  'system'::message_type,
  o.created_at
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM chat_messages cm
  WHERE cm.order_id = o.id
    AND cm.sender_type = 'system'
    AND cm.content LIKE 'Order #%created%'
);

-- Add rate info message for orders that don't have it
INSERT INTO chat_messages (id, order_id, sender_type, sender_id, content, message_type, created_at)
SELECT
  uuid_generate_v4(),
  o.id,
  'system'::actor_type,
  o.id::text,
  'Rate: ' || o.rate || ' AED/USDC • Total: ' || ROUND(o.fiat_amount::numeric, 2) || ' AED',
  'system'::message_type,
  o.created_at + INTERVAL '1 second'
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM chat_messages cm
  WHERE cm.order_id = o.id
    AND cm.sender_type = 'system'
    AND cm.content LIKE 'Rate:%'
);

-- Log the migration
DO $$
DECLARE
  msg_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO msg_count FROM chat_messages WHERE sender_type = 'system' AND message_type = 'system';
  RAISE NOTICE 'Backfill complete. Total system messages: %', msg_count;
END $$;
