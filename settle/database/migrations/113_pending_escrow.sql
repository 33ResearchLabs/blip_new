-- Migration 113: pending_escrow — durable record of "escrow lock in flight".
--
-- WHY THIS EXISTS
--   On-chain commit (Solana) and DB commit (Postgres) have no shared
--   transaction. The previous design relied on the client to call a settle
--   PATCH after the on-chain tx confirmed. Any failure between those two
--   points (tab close, network drop, slow Solana indexing causing client
--   to declare failure prematurely) created an "orphan": funds locked
--   on-chain, no DB row, the order auto-cancels later without refund.
--   On 2026-04-20 a reconciliation run found 1,711 such orphans.
--
--   This table closes the gap by recording the INTENT to lock BEFORE the
--   client signs anything. A background worker (escrow-reconciler) then
--   polls Solana for the deterministically-derived trade PDA and reflects
--   on-chain reality into the orders table — without trusting the client
--   to be the bridge between the two ledgers.
--
-- LIFECYCLE
--   broadcasting          : client has registered intent, may or may not
--                           have submitted on-chain yet
--   awaiting_confirmation : client reported a signature, worker should
--                           poll for it
--   confirmed             : worker found funds in the trade PDA and
--                           applied them to the order (terminal)
--   failed                : worker confirmed nothing landed within
--                           timeout_at, safe to auto-cancel order (terminal)
--
-- One in-flight row per (order_id, merchant_id) — partial unique index
-- below. Once a row is terminal (resolved_at NOT NULL) a new attempt can
-- start; this allows retry after a genuine on-chain failure.

CREATE TABLE IF NOT EXISTS pending_escrow (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The order this lock is for. NOT a foreign key — we want the row to
  -- survive the order being deleted; reconciliation history is forensic.
  order_id            UUID        NOT NULL,

  -- Who is locking. Pulled from the verified auth context at intent time.
  merchant_id         UUID,
  user_id             UUID,
  actor_type          VARCHAR(16) NOT NULL CHECK (actor_type IN ('user', 'merchant')),
  actor_wallet        VARCHAR(64) NOT NULL,

  -- The trade_id is generated client-side OR server-side and committed
  -- before the client signs. The trade PDA is then deterministic from
  -- (actor_wallet, trade_id) — see findTradePda(). The worker polls this
  -- PDA on every tick.
  trade_id            BIGINT      NOT NULL,
  expected_amount     NUMERIC(20, 8) NOT NULL,

  -- Filled in by the client once it has submitted (best-effort). The
  -- worker does NOT depend on this — it can find the PDA without the sig.
  -- But the sig speeds up reconciliation and gives a forensic link.
  reported_signature  VARCHAR(128),

  -- State machine. See file header.
  status              VARCHAR(24) NOT NULL DEFAULT 'broadcasting'
    CHECK (status IN ('broadcasting', 'awaiting_confirmation', 'confirmed', 'failed')),

  -- Worker bookkeeping.
  attempts            INTEGER     NOT NULL DEFAULT 0,
  last_polled_at      TIMESTAMPTZ,
  last_error          TEXT,

  -- Auth-cancel guard reads this: while we're past `timeout_at` AND not
  -- terminal, the worker hasn't confirmed either way and the order MUST
  -- NOT be auto-cancelled. Default = NOW() + 10 minutes; the worker
  -- escalates a row to `failed` only after this elapses with no on-chain
  -- evidence of the trade.
  timeout_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),

  -- Idempotency: same (order_id, merchant_id, trade_id) twice is a no-op.
  -- See partial unique index below for the in-flight constraint.
  idempotency_key     TEXT,

  -- Audit.
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ,
  resolution_note     TEXT
);

-- One in-flight row per order. After the row resolves, a new lock attempt
-- (manual retry, second user clicking Lock) creates a fresh row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_escrow_inflight_per_order
  ON pending_escrow (order_id)
  WHERE resolved_at IS NULL;

-- Idempotency on intent endpoint: client can safely retry POST
-- /api/orders/:id/escrow/intent with the same key and get the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_escrow_idempotency
  ON pending_escrow (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Worker hot path: cheap scan of unresolved rows ordered by polling age.
CREATE INDEX IF NOT EXISTS idx_pending_escrow_worker_queue
  ON pending_escrow (last_polled_at NULLS FIRST, created_at)
  WHERE resolved_at IS NULL;

-- Forensic + admin-list lookups by (order|merchant|user).
CREATE INDEX IF NOT EXISTS idx_pending_escrow_order
  ON pending_escrow (order_id);

CREATE INDEX IF NOT EXISTS idx_pending_escrow_merchant_status
  ON pending_escrow (merchant_id, status)
  WHERE merchant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_escrow_user_status
  ON pending_escrow (user_id, status)
  WHERE user_id IS NOT NULL;

-- updated_at autotouch — same pattern used elsewhere in the schema.
CREATE OR REPLACE FUNCTION pending_escrow_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pending_escrow_touch ON pending_escrow;
CREATE TRIGGER trg_pending_escrow_touch
  BEFORE UPDATE ON pending_escrow
  FOR EACH ROW
  EXECUTE FUNCTION pending_escrow_touch_updated_at();
