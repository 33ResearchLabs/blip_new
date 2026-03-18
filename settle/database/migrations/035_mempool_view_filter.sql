-- Only show orders that opted into the mempool bump system
-- Normal orders (no bump, no premium) should not appear as mempool orders
CREATE OR REPLACE VIEW v_mempool_orders AS
SELECT o.id,
    o.order_number,
    o.corridor_id,
    o.side,
    o.crypto_amount AS amount_usdt,
    o.ref_price_at_create,
    o.premium_bps_current,
    o.premium_bps_cap,
    o.bump_step_bps,
    o.bump_interval_sec,
    o.auto_bump_enabled,
    o.next_bump_at,
    calculate_offer_price(o.ref_price_at_create, o.premium_bps_current) AS current_offer_price,
    calculate_offer_price(o.ref_price_at_create, o.premium_bps_cap) AS max_offer_price,
    o.expires_at,
    EXTRACT(epoch FROM o.expires_at::timestamp with time zone - now())::integer AS seconds_until_expiry,
    o.user_id,
    o.merchant_id AS creator_merchant_id,
    u.username AS creator_username,
    o.created_at,
    o.status
   FROM orders o
     LEFT JOIN users u ON o.user_id = u.id
  WHERE o.status = 'pending'::order_status
    AND now() < o.expires_at
    AND (o.auto_bump_enabled = true OR o.premium_bps_current > 0)
  ORDER BY o.premium_bps_current DESC, o.created_at;
