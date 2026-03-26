-- Performance indexes for worker queries and hot read paths
--
-- NOTE: Cannot use CONCURRENTLY here because the migration runner
-- executes each file inside a transaction block, and PostgreSQL
-- does not allow CREATE INDEX CONCURRENTLY inside a transaction.
-- Regular CREATE INDEX is fine — these are small filtered indexes.

-- Payment deadline worker: WHERE status = 'payment_sent' AND payment_deadline < NOW()
CREATE INDEX IF NOT EXISTS idx_orders_payment_deadline
  ON orders (payment_deadline)
  WHERE status = 'payment_sent' AND payment_deadline IS NOT NULL;

-- Orders queried by status + created_at DESC (admin, listing, active orders)
CREATE INDEX IF NOT EXISTS idx_orders_status_recent
  ON orders (status, created_at DESC)
  WHERE status NOT IN ('completed', 'cancelled', 'expired');
