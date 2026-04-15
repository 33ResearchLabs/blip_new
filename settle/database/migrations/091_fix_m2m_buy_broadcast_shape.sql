-- 091_fix_m2m_buy_broadcast_shape.sql
--
-- Backfill historical M2M BUY self-broadcast orders that were written in the
-- wrong slot shape. Per CLAUDE.md's M2M invariant:
--   merchant_id       = ALWAYS seller
--   buyer_merchant_id = ALWAYS buyer
--
-- The creation route used to always put the creator into merchant_id, even when
-- the creator was the buyer (user-perspective type='sell' with a placeholder
-- user and no buyer_merchant_id). Those rows look identical to M2M SELL
-- broadcasts but have inverted roles, which flips YOU PAY / YOU RECEIVE labels
-- and routes the M2M acceptance path into the wrong slot.
--
-- This migration swaps those rows into the correct shape:
--   merchant_id       → NULL (awaits seller to claim)
--   buyer_merchant_id → former merchant_id (the creator, who is the buyer)
--
-- SAFETY:
--   • Only rewrites rows in pending / expired / cancelled states. Accepted+
--     rows have ledger, escrow, and merchant_transactions entries committed
--     against the old IDs — flipping those now would desync reconciliation.
--   • Only rewrites rows with a placeholder user (open_order_* / m2m_*) and
--     buyer_merchant_id IS NULL — the signature of an unclaimed broadcast.
--   • Skips rows with any escrow state (escrow_tx_hash, escrow_debited_*),
--     since those would've been funded against merchant_id. A buy-intent
--     broadcast shouldn't have escrow in the first place; defensive guard.
--   • Idempotent: re-running does nothing because the same rows no longer
--     match the WHERE predicate after the first run.

BEGIN;

-- Snapshot affected rows for audit, in case reconciliation is needed later.
CREATE TABLE IF NOT EXISTS _migration_091_m2m_shape_backfill (
  order_id            uuid PRIMARY KEY,
  order_number        varchar(20),
  original_merchant_id uuid,
  original_buyer_merchant_id uuid,
  status              varchar(40),
  migrated_at         timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO _migration_091_m2m_shape_backfill (order_id, order_number, original_merchant_id, original_buyer_merchant_id, status)
SELECT o.id, o.order_number, o.merchant_id, o.buyer_merchant_id, o.status::text
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.type = 'sell'                                          -- user-perspective sell = merchant wants to BUY
  AND o.merchant_id IS NOT NULL
  AND o.buyer_merchant_id IS NULL
  AND (u.username LIKE 'open_order_%' OR u.username LIKE 'm2m_%')
  AND o.status IN ('pending', 'expired', 'cancelled')
  AND o.escrow_tx_hash IS NULL
  AND o.escrow_debited_entity_id IS NULL
  AND o.accepted_at IS NULL
ON CONFLICT (order_id) DO NOTHING;

-- Flip the slots on the same set.
UPDATE orders o
SET
  buyer_merchant_id = o.merchant_id,
  merchant_id       = NULL
FROM users u
WHERE u.id = o.user_id
  AND o.type = 'sell'
  AND o.merchant_id IS NOT NULL
  AND o.buyer_merchant_id IS NULL
  AND (u.username LIKE 'open_order_%' OR u.username LIKE 'm2m_%')
  AND o.status IN ('pending', 'expired', 'cancelled')
  AND o.escrow_tx_hash IS NULL
  AND o.escrow_debited_entity_id IS NULL
  AND o.accepted_at IS NULL;

COMMIT;
