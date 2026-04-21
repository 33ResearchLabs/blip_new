-- Migration 103: Escrow reconciliation run + finding audit tables.
--
-- Supports the escrow reconciler worker (reconcileEscrow.ts). The worker
-- scans on-chain Trade PDAs against the orders table and records every
-- mismatch here for admin review. All writes are append-only; the
-- reconciler never mutates orders, escrow, or ledger state.
--
-- Idempotent re-detection is enforced by the UNIQUE key on
-- (kind, trade_pda, run_id IS NULL). New runs do NOT produce duplicate
-- "open" rows for the same on-chain artefact; a separate admin action
-- marks a finding resolved.

CREATE TABLE IF NOT EXISTS escrow_reconciliation_runs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  status             VARCHAR(20) NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'completed', 'failed')),
  trades_scanned     INTEGER     NOT NULL DEFAULT 0,
  orders_scanned     INTEGER     NOT NULL DEFAULT 0,
  findings_new       INTEGER     NOT NULL DEFAULT 0,
  findings_existing  INTEGER     NOT NULL DEFAULT 0,
  dry_run            BOOLEAN     NOT NULL DEFAULT FALSE,
  error_message      TEXT,
  metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_escrow_recon_runs_started
  ON escrow_reconciliation_runs (started_at DESC);

-- One row per detected mismatch. resolved_at set by admin action.
CREATE TABLE IF NOT EXISTS escrow_reconciliation_findings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  first_seen_run  UUID        NOT NULL REFERENCES escrow_reconciliation_runs(id),
  last_seen_run   UUID        NOT NULL REFERENCES escrow_reconciliation_runs(id),
  -- Classification of the mismatch:
  --   orphaned_escrow : Trade PDA exists on-chain, no matching order row
  --   ghost_db        : Order marked escrowed, no matching on-chain Trade
  --   amount_mismatch : Both exist, but on-chain amount != order.crypto_amount
  --   status_mismatch : Both exist, but statuses disagree (e.g. DB=completed,
  --                     chain=Locked, or chain=Refunded, DB=escrowed)
  kind            VARCHAR(32) NOT NULL
                    CHECK (kind IN ('orphaned_escrow', 'ghost_db', 'amount_mismatch', 'status_mismatch')),
  -- Keys for joining either side.
  trade_pda       TEXT,       -- on-chain Trade account (base58)
  order_id        UUID        REFERENCES orders(id),
  escrow_tx_hash  TEXT,
  -- Snapshots captured at first detection. Stored as jsonb for flexibility.
  chain_snapshot  JSONB,
  db_snapshot     JSONB,
  suggested_action VARCHAR(40),
  severity        VARCHAR(10) NOT NULL DEFAULT 'CRITICAL'
                    CHECK (severity IN ('INFO','WARN','ERROR','CRITICAL')),
  seen_count      INTEGER     NOT NULL DEFAULT 1,
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID,
  resolution_note TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A finding is identified by (kind, trade_pda) for chain-side things, or
-- (kind, order_id) for db-side things. Only one OPEN (unresolved) row per
-- such key. Using COALESCE lets a single partial index cover both cases.
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_recon_findings_open_key
  ON escrow_reconciliation_findings (
    kind,
    COALESCE(trade_pda, ''),
    COALESCE(order_id::text, '')
  )
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_escrow_recon_findings_open
  ON escrow_reconciliation_findings (created_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_escrow_recon_findings_kind
  ON escrow_reconciliation_findings (kind, severity) WHERE resolved_at IS NULL;

COMMENT ON TABLE escrow_reconciliation_runs
  IS 'One row per reconciliation worker invocation. Observability only.';
COMMENT ON TABLE escrow_reconciliation_findings
  IS 'One row per unresolved mismatch between on-chain Trade PDAs and orders table. Admin resolves manually.';
