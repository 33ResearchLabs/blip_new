-- ═══════════════════════════════════════════════════════════════════════
-- 108: Narrow the release_tx_hash unique index to actual tx hashes only
-- ═══════════════════════════════════════════════════════════════════════
--
-- Context:
--   The unique index added in migration 065 covers every non-NULL value of
--   `release_tx_hash`. The refund / release code paths also write
--   non-transactional sentinel strings into this column to record WHY the
--   row never got a real tx:
--
--     • 'escrow-already-closed'  — Solana escrow account no longer exists
--     • 'already-refunded'       — on-chain refund program reported double
--     • 'server-release-<ts>'    — successful server-side release
--     • 'server-release-fallback-<ts>' — retry/fallback path
--
--   The timestamped ones accidentally satisfy the unique constraint (each
--   call mints a new suffix). The two exact strings
--   `escrow-already-closed` and `already-refunded` repeat verbatim across
--   orders, so the 2nd+ write of each sentinel collides and throws 23505.
--
--   Observed on prod: the refund worker in payment-deadline-worker.ts
--   retries every 30 s, hit 360 failures in ~2h, left 10 orders stuck in
--   a tight loop (refund_retry_after never clears because the UPDATE
--   that would clear it is the one that crashed).
--
-- Fix:
--   Rebuild the index so it covers only "real" tx hashes. Sentinel strings
--   are now allowed to collide (or rather, they should be NULL — see the
--   companion code patch in payment-deadline-worker.ts, but this index
--   change is safe on its own even if a sentinel lingers).
--
--   Criteria for "real": non-NULL and matches the Solana base58 shape
--   (32–100 chars of base58 alphabet). Everything else — sentinel strings,
--   placeholders, future-added markers — is excluded.
--
-- Safety:
--   • Index is partial and narrower than the old one; any row the old
--     index covered that still matches the new predicate retains its
--     uniqueness protection.
--   • `CREATE UNIQUE INDEX IF NOT EXISTS` + new name means the migration
--     is re-runnable. The old index is dropped first so both cannot exist
--     side-by-side with overlapping (but different) predicates.
--   • Transaction-wrapped by the migration runner, consistent with the
--     house rule in CLAUDE.md (no CONCURRENTLY).

DROP INDEX IF EXISTS idx_orders_unique_release_tx_hash;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_release_tx_hash
  ON orders (release_tx_hash)
  WHERE release_tx_hash IS NOT NULL
    AND release_tx_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,100}$';
