-- Migration 171: record WHO raised a pending mutual-cancel request (actor id).
--
-- `cancel_requested_by` only stores an actor TYPE ('user' | 'merchant'), which
-- is ambiguous for M2M orders where BOTH parties are merchants — the
-- counterparty can't be told apart from the requester. Storing the actor id
-- lets the UI reliably show "Agree / Decline" to the counterparty and
-- "Waiting…" to the requester. Idempotent + re-runnable.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancel_requested_by_id uuid;

COMMENT ON COLUMN public.orders.cancel_requested_by_id IS
  'Actor id (user/merchant) who raised the pending mutual-cancel request; cleared when the request is declined/resolved';
