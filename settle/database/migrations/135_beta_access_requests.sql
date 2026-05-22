-- ============================================================================
-- 135_beta_access_requests.sql
--
-- "Send Request for Merchant P2P App Test" lives on the waitlist dashboard.
-- Clicking it inserts a row here so admins can review the queue and reach
-- out / grant access. The row stores everything the admin needs WITHOUT
-- trusting the client — actor identity comes from the auth cookie, and
-- profile fields are snapshotted from users/merchants at write time so a
-- later name/email change doesn't rewrite history.
--
-- Idempotent design (re-runs are no-ops):
--   - Partial unique index on (actor_type, actor_id) WHERE status='pending'
--     blocks a single actor from queueing multiple open requests.
--   - Status transitions: pending → approved | rejected | contacted.
--     `contacted` is a soft state so admins can mark "DMed them, awaiting
--     reply" without closing the row.
--   - Status enum enforced via CHECK constraint, ALTER-safe via DO block.
--
-- Scale: small table (one row per actor max while pending, plus history
-- after admin action). One composite index on (status, requested_at DESC)
-- powers the admin queue view.
-- ============================================================================

CREATE TABLE IF NOT EXISTS beta_access_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        uuid NOT NULL,
  actor_type      text NOT NULL,
  email           text,
  display_name    text,
  business_name   text,            -- NULL for users; mirrors merchants.business_name
  country_code    text,            -- NULL when unknown
  -- Merchant-only — declared expected monthly trading volume in USD.
  -- Collected via a small prompt the merchant fills BEFORE the request
  -- is submitted. NULL when the requester is a user, or when the field
  -- is later widened to include users without retroactively requiring it.
  -- numeric(20,2) matches merchants.expected_monthly_volume_usd from
  -- migration 131 so admin views can reconcile the two side by side.
  expected_trading_amount_usd numeric(20,2),
  note            text,            -- reserved for a future free-text field; NULL today
  status          text NOT NULL DEFAULT 'pending',
  admin_notes     text,            -- admin-only annotations
  requested_at    timestamptz NOT NULL DEFAULT NOW(),
  reviewed_at     timestamptz,
  reviewed_by     text             -- admin username from blip_admin_token, NOT a FK
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'beta_access_requests_actor_type_check'
  ) THEN
    ALTER TABLE beta_access_requests
      ADD CONSTRAINT beta_access_requests_actor_type_check
      CHECK (actor_type IN ('user', 'merchant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'beta_access_requests_status_check'
  ) THEN
    ALTER TABLE beta_access_requests
      ADD CONSTRAINT beta_access_requests_status_check
      CHECK (status IN ('pending', 'approved', 'rejected', 'contacted'));
  END IF;
END$$;

-- One open request per actor — a re-click while pending returns the existing
-- row instead of creating a duplicate. Once status moves off 'pending', the
-- actor can submit a fresh request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_beta_access_requests_one_pending
  ON beta_access_requests (actor_type, actor_id)
  WHERE status = 'pending';

-- Admin queue: "show me the open pending requests, newest first."
CREATE INDEX IF NOT EXISTS idx_beta_access_requests_status_recent
  ON beta_access_requests (status, requested_at DESC);

-- Lookup index for the /api/waitlist/me extension that reports whether
-- the actor has any request (any state) so the UI can flip the button to
-- "Request Sent" / "Approved" / etc.
CREATE INDEX IF NOT EXISTS idx_beta_access_requests_actor
  ON beta_access_requests (actor_type, actor_id, requested_at DESC);
