-- 158_limit_increase_requests.sql
--
-- Merchant/user-initiated requests to raise their daily or per-transaction
-- trade limit. Surfaced in Settings → Limits ("Request Limit Increase" +
-- "Recent Limit Requests"). Reviewed by compliance/admin out-of-band; the
-- merchant only sees their own rows + the resolved status.
--
-- Limits are USD-denominated everywhere in the limit system (see
-- src/lib/coins/limits.ts), so current/requested amounts are stored in USD.
-- The UI converts to the merchant's display currency (INR) at the live
-- corridor rate. Idempotent / re-runnable per the migration rules.

CREATE TABLE IF NOT EXISTS limit_increase_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type          text          NOT NULL,
  actor_id            UUID          NOT NULL,
  kind                text          NOT NULL,   -- 'daily' | 'per_transaction'
  current_limit_usd   NUMERIC(12,2) NOT NULL,
  requested_limit_usd NUMERIC(12,2) NOT NULL,
  reason              text,
  status              text          NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  reviewed_by         text,
  reviewed_at         timestamptz,
  created_at          timestamptz   NOT NULL DEFAULT NOW()
);

-- CHECK constraints added defensively (re-runnable): only attach if absent.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'limit_increase_requests_actor_type_check'
  ) THEN
    ALTER TABLE limit_increase_requests
      ADD CONSTRAINT limit_increase_requests_actor_type_check
      CHECK (actor_type IN ('user','merchant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'limit_increase_requests_kind_check'
  ) THEN
    ALTER TABLE limit_increase_requests
      ADD CONSTRAINT limit_increase_requests_kind_check
      CHECK (kind IN ('daily','per_transaction'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'limit_increase_requests_status_check'
  ) THEN
    ALTER TABLE limit_increase_requests
      ADD CONSTRAINT limit_increase_requests_status_check
      CHECK (status IN ('pending','approved','rejected'));
  END IF;
END $$;

-- Hot read: "this actor's requests, newest first" (history list).
CREATE INDEX IF NOT EXISTS idx_limit_increase_requests_actor
  ON limit_increase_requests (actor_type, actor_id, created_at DESC);

-- Hot read: "pending request of this kind?" (duplicate guard on create).
CREATE INDEX IF NOT EXISTS idx_limit_increase_requests_pending
  ON limit_increase_requests (actor_type, actor_id, kind)
  WHERE status = 'pending';
