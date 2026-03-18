-- Migration 037: Order Receipts
-- Creates a dedicated order_receipts table to store receipt snapshots
-- for both User→Merchant and Merchant→Merchant (M2M) orders.

CREATE TABLE IF NOT EXISTS public.order_receipts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL PRIMARY KEY,
    order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
    order_number character varying(20) NOT NULL,

    -- Order details (snapshot at acceptance time)
    type character varying(10) NOT NULL,
    payment_method character varying(50) NOT NULL,
    crypto_amount numeric(20,6) NOT NULL,
    crypto_currency character varying(10) NOT NULL,
    fiat_amount numeric(20,2) NOT NULL,
    fiat_currency character varying(10) NOT NULL,
    rate numeric(20,4) NOT NULL,
    platform_fee numeric(20,6) DEFAULT 0,
    protocol_fee_amount numeric(20,8),

    -- Current status (updated on every transition)
    status character varying(30) NOT NULL,

    -- Creator party snapshot
    creator_type character varying(20) NOT NULL,  -- 'user' or 'merchant'
    creator_id uuid NOT NULL,
    creator_name character varying(100),
    creator_wallet_address character varying(128),

    -- Acceptor party snapshot
    acceptor_type character varying(20) NOT NULL,  -- 'merchant'
    acceptor_id uuid NOT NULL,
    acceptor_name character varying(100),
    acceptor_wallet_address character varying(128),

    -- Payment details snapshot
    payment_details jsonb,

    -- Escrow & transaction hashes (updated as order progresses)
    escrow_tx_hash character varying(128),
    release_tx_hash character varying(128),
    refund_tx_hash character varying(128),

    -- Key timestamps
    accepted_at timestamp without time zone,
    escrowed_at timestamp without time zone,
    payment_sent_at timestamp without time zone,
    completed_at timestamp without time zone,
    cancelled_at timestamp without time zone,

    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_order_receipts_creator_id ON public.order_receipts (creator_id);
CREATE INDEX IF NOT EXISTS idx_order_receipts_acceptor_id ON public.order_receipts (acceptor_id);
CREATE INDEX IF NOT EXISTS idx_order_receipts_status ON public.order_receipts (status);
CREATE INDEX IF NOT EXISTS idx_order_receipts_created_at ON public.order_receipts (created_at DESC);
