-- Compliance-officer voting on dispute resolutions. A resolution passes when a
-- strict majority (>50%, i.e. "51% plus") of active compliance officers vote the
-- same outcome within the voting window (4h). A single officer may instead
-- "force" the resolution (override) — recorded with force=true on the dispute.
CREATE TABLE IF NOT EXISTS compliance_dispute_votes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL,
  voter_id    UUID NOT NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN ('user', 'merchant', 'split')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_cdv_order ON compliance_dispute_votes(order_id);

-- Audit: who force-resolved a dispute (single-officer override), if anyone.
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS force_resolved_by UUID;
