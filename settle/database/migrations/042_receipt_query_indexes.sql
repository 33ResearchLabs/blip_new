-- Migration 042: Optimize order_receipts for high-performance pagination queries.
--
-- Problem: GET /api/receipts runs:
--   WHERE (creator_id = ANY($1) OR acceptor_id = ANY($1))
--   ORDER BY created_at DESC  LIMIT N OFFSET M
--
-- The OR across two columns forces a BitmapOr of two index scans, followed
-- by a heap fetch and re-sort.  Individual single-column indexes on
-- creator_id and acceptor_id cannot satisfy ORDER BY or filter by status
-- without additional heap lookups.
--
-- Fix: composite covering indexes that let each half of the OR use an
-- Index-Only Scan (or at minimum an Index Scan with pre-sorted results).

-- 1. Drop the old single-column indexes (superseded by composites below)
DROP INDEX IF EXISTS idx_order_receipts_creator_id;
DROP INDEX IF EXISTS idx_order_receipts_acceptor_id;
DROP INDEX IF EXISTS idx_order_receipts_status;
DROP INDEX IF EXISTS idx_order_receipts_created_at;

-- 2. Composite indexes for the "my receipts" query.
--    Each covers one side of the OR and includes created_at for sort + status
--    for filtering, so Postgres can do two fast Index Scans → merge.
--
--    Column order: participant_id → created_at DESC → status
--    (equality on participant, sort on created_at, optional filter on status)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receipts_creator_id_created
  ON order_receipts (creator_id, created_at DESC, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receipts_acceptor_id_created
  ON order_receipts (acceptor_id, created_at DESC, status);

-- 3. Covering index for single-receipt lookup (already fast via UNIQUE, but
--    this lets us add INCLUDE columns for Index-Only Scan on common fields).
--    The UNIQUE constraint on order_id already creates a btree index, so we
--    skip adding another one — the planner will use the unique index.

-- 4. Status + created_at for admin/compliance dashboards that filter by status
--    across all receipts (no participant filter).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receipts_status_created
  ON order_receipts (status, created_at DESC);

-- 5. Keyset (cursor) pagination requires a tiebreaker.  The (created_at, id)
--    pair is unique and monotonically increasing, so it works as a stable cursor.
--    The composite indexes above already have created_at; adding id to the
--    WHERE clause still benefits because Postgres can filter on the heap row
--    cheaply after the index narrows the set.
--    No extra index needed — the composites above are sufficient.
