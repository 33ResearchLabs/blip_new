-- Migration 172: Track the proposer's actor id on appeals
--
-- Bilateral appeal resolution lets EITHER party propose a resolution
-- (release-to-buyer / mutual-cancel) which the OTHER party then accepts. The
-- safety rule for mutual-cancel is that both parties must consent — i.e. the
-- accepter must NOT be the proposer.
--
-- Migration 170 already stores `appeals.proposed_by` as an actor_type, but that
-- is not enough to identify the specific actor in an M2M order where BOTH parties
-- are merchants (actor_type='merchant' on each side). We add the proposer's
-- actor id so the "cannot accept your own proposal" guard is correct in every
-- order shape.
--
-- Additive + idempotent + re-runnable. No data backfill needed (NULL = legacy
-- rows with no standing proposal).

ALTER TABLE public.appeals
  ADD COLUMN IF NOT EXISTS proposed_by_id uuid;

COMMENT ON COLUMN public.appeals.proposed_by_id IS
  'Actor id of the party that proposed the standing resolution (pairs with proposed_by actor_type). Used to enforce that the accepter is not the proposer.';
