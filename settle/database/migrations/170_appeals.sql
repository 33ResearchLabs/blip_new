-- Migration 170: Appeal System (peer-to-peer resolution stage BEFORE dispute)
--
-- An appeal is a structured, peer-resolved stage that happens before a formal
-- dispute. Either party (buyer/seller) can open one on an active order
-- (accepted/escrowed/payment_sent), attach evidence, propose a resolution
-- (complete the order, or mutual cancel + refund), or escalate to a dispute.
-- A 12h timeout auto-escalates an unresolved appeal to a dispute.
--
-- Idempotent + re-runnable (the core-api migration runner wraps each file in a
-- transaction and applies it exactly once). No CONCURRENTLY.

-- =====================
-- ENUM: appeal_status
-- =====================
-- CREATE TYPE has no IF NOT EXISTS form for enums; guard with a DO block so the
-- migration is safely re-runnable.
DO $$
BEGIN
  CREATE TYPE public.appeal_status AS ENUM (
    'open',        -- appeal raised, parties discussing
    'proposed',    -- one party proposed a resolution, awaiting the other
    'resolved',    -- peer-resolved → order completed
    'cancelled',   -- peer-resolved → order cancelled + refunded (mutual cancel)
    'escalated',   -- moved to a formal dispute (terminal for the appeal)
    'expired'      -- timed out (reserved; timeout currently escalates instead)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================
-- TABLE: appeals
-- =====================
CREATE TABLE IF NOT EXISTS public.appeals (
    id                  uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    opened_by           public.actor_type NOT NULL,        -- 'user' | 'merchant'
    opener_id           uuid NOT NULL,
    issue_key           text NOT NULL,                     -- e.g. 'payment_received_late'
    issue_group         text NOT NULL DEFAULT 'resolvable',-- 'resolvable' | 'dispute'
    description         text,
    status              public.appeal_status NOT NULL DEFAULT 'open',
    proposed_resolution text,                              -- 'complete' | 'mutual_cancel'
    proposed_by         public.actor_type,
    proposed_at         timestamptz,
    appeal_deadline     timestamptz NOT NULL,              -- created_at + APPEAL_TIMEOUT
    resolved_at         timestamptz,
    escalated_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT appeals_pkey PRIMARY KEY (id),
    CONSTRAINT appeals_issue_group_check
      CHECK (issue_group IN ('resolvable', 'dispute')),
    CONSTRAINT appeals_proposed_resolution_check
      CHECK (proposed_resolution IS NULL OR proposed_resolution IN ('complete', 'mutual_cancel'))
);

-- One ACTIVE appeal per order (open or proposed). Resolved/cancelled/escalated
-- rows are historical and don't block — but the no-loop rule (a disputed order
-- can't reopen) is enforced in code, not here.
CREATE UNIQUE INDEX IF NOT EXISTS ux_appeals_one_active
  ON public.appeals(order_id)
  WHERE status IN ('open', 'proposed');

CREATE INDEX IF NOT EXISTS idx_appeals_order ON public.appeals(order_id);

-- Drives the appeal-timeout worker (claim active appeals past their deadline).
CREATE INDEX IF NOT EXISTS idx_appeals_deadline
  ON public.appeals(status, appeal_deadline);

-- =====================
-- TABLE: appeal_evidence
-- =====================
-- Per-party evidence with attribution (both buyer and seller can upload). URLs
-- point at the existing Cloudinary store (folder 'blip/appeals').
CREATE TABLE IF NOT EXISTS public.appeal_evidence (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    appeal_id       uuid NOT NULL REFERENCES public.appeals(id) ON DELETE CASCADE,
    order_id        uuid NOT NULL,
    uploaded_by     public.actor_type NOT NULL,
    actor_id        uuid NOT NULL,
    cloudinary_url  text NOT NULL,
    public_id       text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT appeal_evidence_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_appeal_evidence_appeal
  ON public.appeal_evidence(appeal_id);

-- =====================
-- ORDERS: denormalized appeal flags
-- =====================
-- Denormalized onto orders so the expiry/auto-cancel/auto-dispute workers can
-- cheaply skip orders with an open appeal, and the UI can badge them, without a
-- join. Kept in sync by the appeal endpoints + appeal-timeout worker.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS appeal_status   text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS appeal_deadline timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_appeal_status
  ON public.orders(appeal_status)
  WHERE appeal_status IS NOT NULL;

-- =====================
-- COMMENTS
-- =====================
COMMENT ON TABLE  public.appeals IS 'Peer-to-peer resolution stage before a formal dispute';
COMMENT ON COLUMN public.appeals.issue_group IS 'resolvable = peer-fixable case; dispute = should escalate to moderator';
COMMENT ON COLUMN public.appeals.proposed_resolution IS 'complete = release to buyer; mutual_cancel = refund seller + cancel';
COMMENT ON COLUMN public.appeals.appeal_deadline IS 'When an unresolved appeal auto-escalates to a dispute';
COMMENT ON COLUMN public.orders.appeal_status IS 'Denormalized active-appeal status for cheap worker/UI checks';
COMMENT ON COLUMN public.orders.appeal_deadline IS 'Denormalized active-appeal deadline (auto-escalation time)';
