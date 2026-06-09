-- 159_limit_increase_requests_approved_index.sql
--
-- An APPROVED limit-increase request acts as the per-actor limit override:
-- getEffectiveLimits() reads the latest approved request per kind and raises
-- that actor's effective daily / per-transaction cap. That read runs on every
-- order create (the enforcement hot path), so back it with an index.
--
-- Idempotent / re-runnable.

CREATE INDEX IF NOT EXISTS idx_limit_increase_requests_approved
  ON limit_increase_requests (actor_type, actor_id, kind, reviewed_at DESC)
  WHERE status = 'approved';
