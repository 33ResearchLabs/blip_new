-- Migration 175: Add disputes.initiated_by column
--
-- BACKGROUND:
-- Production's `disputes` table is missing the `initiated_by` column even
-- though it exists in schema.sql. No prior migration ever created it, so
-- prod (which builds its schema from the numbered migrations) never got it.
--
-- The appeal → dispute escalation path is the ONLY writer of this column:
--
--   apps/core-api/src/appeals/escalate.ts:
--     INSERT INTO disputes (
--        order_id, reason, description, raised_by, raiser_id, status,
--        user_confirmed, merchant_confirmed, initiated_by, created_at   -- ← missing on prod
--     ) VALUES (..., 'appeal_escalation', NOW())
--
-- The regular dispute route (routes/dispute.ts) and the auto-dispute worker
-- (workers/unhappyPathWorker.ts) both OMIT initiated_by, which is why normal
-- disputes work but "Escalate to Dispute" crashes with
--   ERROR: column "initiated_by" of relation "disputes" does not exist
-- → the appeal PUT handler's catch returns 500 "Internal server error"
-- (the symptom seen in the user appeal banner).
--
-- This brings prod in line with schema.sql. Pure additive, NULL-default,
-- no FK/constraint, idempotent — zero regression (existing rows and queries
-- are untouched; only the escalation INSERT now succeeds).

ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS initiated_by VARCHAR(50) NULL;
