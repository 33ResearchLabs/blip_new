-- Migration 157: mutual cancel for disputed orders
-- Both parties can request to cancel a dispute; when both agree, money returns to depositor.

ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS mutual_cancel_requested_by_user     boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mutual_cancel_user_at               timestamptz,
  ADD COLUMN IF NOT EXISTS mutual_cancel_requested_by_merchant boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mutual_cancel_merchant_at           timestamptz;
