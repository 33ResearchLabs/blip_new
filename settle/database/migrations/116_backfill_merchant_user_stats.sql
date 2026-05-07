-- Migration 116: Backfill merchants.total_volume / total_trades + users.total_volume / total_trades
--
-- Why:
--   The notificationListener trigger that incremented these columns had two bugs:
--     1. It used `order.fiat_amount` instead of `crypto_amount`, mixing
--        currencies (INR, AED, USD) into one column callers treat as USDT.
--        Result: top merchants showed ~5× inflated volume.
--     2. M2M trades only credited the seller (merchant_id), never the buyer
--        (buyer_merchant_id). Merchants who buy from other merchants were
--        under-counted.
--
--   The trigger code was fixed in apps/core-api/src/events/listeners/notificationListener.ts
--   so future completions write correct values. This migration repairs the
--   accumulated historical state in one shot — overwriting the columns with
--   the authoritative answer derived from the orders table.
--
-- Safety:
--   - Read-only on `orders` (the source of truth).
--   - Single UPDATE per row in `merchants` and `users`. No delete, no insert,
--     no concurrent state to race with.
--   - Idempotent — running twice produces the same result. The migration
--     runner records this filename in schema_migrations so it won't re-run
--     anyway, but if pulled into a fresh DB it converges to the same state.
--   - No state-machine effects: these columns are denormalized convenience.
--     The orders table itself is unchanged.
--
-- Volume unit: crypto_amount (USDT-denominated). Same unit the new trigger
-- and the leaderboard query use.

-- ── Merchants ────────────────────────────────────────────────────────────
-- Each merchant row gets the SUM of crypto_amount and COUNT of orders where
-- they were either the seller (merchant_id) OR the M2M buyer (buyer_merchant_id),
-- limited to status='completed'. Cancelled / refunded / disputed orders are
-- excluded — only finalized economic activity counts.
WITH merchant_completed AS (
  SELECT mid AS merchant_id,
         COUNT(*)::int                AS completed_count,
         COALESCE(SUM(crypto_amount), 0) AS completed_volume
  FROM (
    SELECT merchant_id        AS mid, crypto_amount
      FROM orders
      WHERE status = 'completed' AND merchant_id IS NOT NULL
    UNION ALL
    SELECT buyer_merchant_id  AS mid, crypto_amount
      FROM orders
      WHERE status = 'completed' AND buyer_merchant_id IS NOT NULL
  ) participants
  GROUP BY mid
)
UPDATE merchants m
   SET total_trades = COALESCE(mc.completed_count, 0),
       total_volume = COALESCE(mc.completed_volume, 0)
  FROM (
    SELECT id FROM merchants
  ) all_m
  LEFT JOIN merchant_completed mc ON mc.merchant_id = all_m.id
 WHERE m.id = all_m.id;

-- ── Users ────────────────────────────────────────────────────────────────
-- Users participate as either user_id (real person) on non-M2M orders.
-- M2M placeholder users (username starts with 'open_order_' or 'm2m_') do
-- NOT accumulate trade stats — they're just routing artifacts.
WITH user_completed AS (
  SELECT o.user_id,
         COUNT(*)::int                  AS completed_count,
         COALESCE(SUM(o.crypto_amount), 0) AS completed_volume
  FROM orders o
  JOIN users u ON u.id = o.user_id
  WHERE o.status = 'completed'
    AND o.buyer_merchant_id IS NULL  -- not M2M
    AND u.username NOT LIKE 'open_order_%'
    AND u.username NOT LIKE 'm2m_%'
  GROUP BY o.user_id
)
UPDATE users u
   SET total_trades = COALESCE(uc.completed_count, 0),
       total_volume = COALESCE(uc.completed_volume, 0)
  FROM (SELECT id FROM users) all_u
  LEFT JOIN user_completed uc ON uc.user_id = all_u.id
 WHERE u.id = all_u.id;
