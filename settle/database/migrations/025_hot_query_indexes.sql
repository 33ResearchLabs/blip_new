-- Phase 7: Hot query composite indexes
-- Covers the 3 most-hit order queries that lacked proper covering indexes.

-- getMerchantOrders: WHERE merchant_id=$1 AND status NOT IN ('expired','cancelled') ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_orders_merchant_active
  ON orders (merchant_id, status, created_at DESC)
  WHERE status NOT IN ('expired', 'cancelled');

-- getUserOrders: WHERE user_id=$1 AND status NOT IN ('expired','cancelled') ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_orders_user_active
  ON orders (user_id, status, created_at DESC)
  WHERE status NOT IN ('expired', 'cancelled');

-- getAllPendingOrdersForMerchant broadcast pool: WHERE status IN ('pending','escrowed')
CREATE INDEX IF NOT EXISTS idx_orders_broadcast_pool
  ON orders (status, created_at DESC)
  WHERE status IN ('pending', 'escrowed');
