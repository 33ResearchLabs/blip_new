-- Migration 104: Auction hardening — close the three ship-blocker gaps from
-- the hybrid-pricing audit, without touching the fixed-price code path.
--
-- What this migration does (all additive, idempotent):
--   (1) orders.selected_merchant_wallet           — on-chain winner-wallet
--       binding so the indexer/Anchor reconciler can cross-check that the
--       escrow funder's wallet matches the auction winner.
--   (2) order_auctions.cancellation_reason + cancelled_at — forensic trail
--       for why an auction was cancelled (e.g. merchant claimed during
--       the window). Previously only logged.
--   (3) Replaces accept_order_v1 with a version that refuses to accept an
--       auction-mode order whose auction is still 'open'/'scoring' OR
--       whose auction row is missing entirely. Closes the "race to ACCEPT
--       while bidders are competing" exploit and the silent-downgrade
--       window if createAuction failed after order insert.
--   (4) Trigger trg_no_accept_during_open_auction — DB-level defense in
--       depth covering every write path to orders.status='accepted' /
--       'payment_pending' (including the general PATCH tx path). Belt +
--       suspenders with (3).
--   (5) CHECK invariants:
--         - orders_auction_rate_matches  (I3): when auction is locked,
--           orders.rate == orders.agreed_rate.
--         - order_auctions_window_valid  (I9): window_closes_at must be
--           strictly after window_opens_at.
--   (6) Trigger trg_auction_locked_has_winner (I5): an auction in state
--       'locked' must have a winning_bid_id whose bid status='won'.
--       Complements the existing partial UNIQUE index by catching
--       inconsistent direct writes.
--
-- Fixed-price safety: every check keys off `auction_mode = 'auction'`.
-- Orders with `auction_mode = 'fixed'` (the default for legacy + all
-- pre-hybrid orders) are untouched by any new trigger or CHECK.

-- ────────────────────────────────────────────────────────────────────────
-- (1) orders.selected_merchant_wallet
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS selected_merchant_wallet VARCHAR(64);

COMMENT ON COLUMN orders.selected_merchant_wallet IS
  'Solana wallet of the auction winner, stamped at lockAuctionWinner. Enables on-chain reconciler to verify escrow funder identity.';

-- ────────────────────────────────────────────────────────────────────────
-- (2) order_auctions forensic fields
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE order_auctions
  ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(64),
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ;

COMMENT ON COLUMN order_auctions.cancellation_reason IS
  'Why the auction ended in status=cancelled. Enum-shaped: merchant_claim_during_auction | order_cancelled | manual_admin | compensating_order_cancel.';

-- ────────────────────────────────────────────────────────────────────────
-- (3) accept_order_v1 — refuse ACCEPT on unresolved auction-mode orders
-- ────────────────────────────────────────────────────────────────────────
-- This is the application-level guard. Tight error messages so the client
-- can distinguish "wait, auction still running" from "order already taken".
CREATE OR REPLACE FUNCTION accept_order_v1(
  p_order_id UUID,
  p_actor_type VARCHAR,
  p_actor_id UUID,
  p_acceptor_wallet_address VARCHAR DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_order RECORD;
  v_old_status VARCHAR;
  v_updated RECORD;
  v_effective_status order_status;
  v_username VARCHAR;
  v_is_claiming BOOLEAN;
  v_is_m2m BOOLEAN;
  v_order_type VARCHAR;
  v_auction_status VARCHAR;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;
  v_order_type := v_order.type::TEXT;

  -- ── Auction guard ──────────────────────────────────────────────────
  -- Auction-mode orders can only be accepted AFTER the auction resolves.
  -- 'locked'    → winner set, normal accept by that winner proceeds.
  -- 'no_bids'   → no merchant bid; fall back to base-price accept (any
  --               eligible merchant may claim at base_rate).
  -- 'cancelled' → auction was cancelled (e.g. user cancelled, or a
  --               prior ACCEPT raced in — see compensating flow); base
  --               price still stands.
  -- 'open' / 'scoring' → refuse. A merchant must not capture the order
  --                       at base_rate while bidders are competing.
  -- NULL (no auction row) → refuse. The auction was requested but never
  --                          created (createAuction failed mid-flight).
  --                          Caller must cancel the order instead.
  IF v_order.auction_mode = 'auction' THEN
    SELECT status INTO v_auction_status
      FROM order_auctions WHERE order_id = p_order_id;

    IF v_auction_status IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'AUCTION_NOT_INITIALIZED',
        'detail', 'Auction-mode order has no auction row. Cancel and recreate.'
      );
    END IF;

    IF v_auction_status IN ('open', 'scoring') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'AUCTION_IN_PROGRESS',
        'detail', 'Wait for the bidding window to close before accepting.'
      );
    END IF;

    -- 'locked' + merchant accept: require caller be the winner.
    IF v_auction_status = 'locked'
       AND p_actor_type = 'merchant'
       AND v_order.selected_merchant_id IS DISTINCT FROM p_actor_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'NOT_AUCTION_WINNER',
        'detail', 'This order was won by a different merchant.'
      );
    END IF;
    -- 'no_bids' / 'cancelled' — any eligible merchant may claim at base.
  END IF;
  -- ── /Auction guard ─────────────────────────────────────────────────

  -- Validate transition: accept only from pending or escrowed
  IF v_order.status NOT IN ('pending'::order_status, 'escrowed'::order_status) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Invalid transition from ' || v_order.status || ' to accepted');
  END IF;

  -- Idempotency: already accepted
  IF v_order.status = 'accepted'::order_status OR v_order.accepted_at IS NOT NULL THEN
    IF v_order.buyer_merchant_id = p_actor_id OR v_order.merchant_id = p_actor_id THEN
      RETURN jsonb_build_object('success', true, 'old_status', v_old_status, 'order', row_to_json(v_order));
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_ACCEPTED');
  END IF;

  -- Block self-acceptance of merchant-initiated orders
  IF p_actor_type = 'merchant' AND v_order.merchant_id = p_actor_id THEN
    SELECT username INTO v_username FROM users WHERE id = v_order.user_id;
    IF v_username LIKE 'open_order_%' OR v_username LIKE 'm2m_%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot accept your own order');
    END IF;
  END IF;

  v_is_claiming := (p_actor_type = 'merchant'
    AND v_order.status IN ('pending'::order_status, 'escrowed'::order_status)
    AND v_order.merchant_id IS DISTINCT FROM p_actor_id);

  v_is_m2m := v_is_claiming;

  -- If accepting an already-escrowed order, keep status as escrowed
  v_effective_status := 'accepted'::order_status;
  IF v_order.status = 'escrowed'::order_status AND v_order.escrow_tx_hash IS NOT NULL THEN
    v_effective_status := 'escrowed'::order_status;
  END IF;

  IF v_is_claiming AND v_order.escrow_tx_hash IS NOT NULL AND v_order.buyer_merchant_id IS NULL THEN
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      buyer_merchant_id = p_actor_id,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;

  ELSIF v_is_claiming AND v_order.buyer_merchant_id IS NULL THEN
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      buyer_merchant_id = v_order.merchant_id,
      merchant_id = p_actor_id,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;

  ELSIF v_is_m2m AND v_order.buyer_merchant_id IS NOT NULL THEN
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      merchant_id = p_actor_id,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;

  ELSE
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;
  END IF;

  -- Safety net: block self-referencing result
  IF v_updated.merchant_id = v_updated.buyer_merchant_id THEN
    RAISE EXCEPTION 'Self-referencing order detected after accept (merchant_id = buyer_merchant_id). Rolling back.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'order', row_to_json(v_updated)
  );
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────────────
-- (4) Trigger: block ACCEPT / payment_pending on unresolved auctions
-- ────────────────────────────────────────────────────────────────────────
-- Fires on every UPDATE to orders.status, not just accept_order_v1. Covers
-- the general PATCH path in core-api/routes/orders.ts and any ad-hoc SQL
-- that bypasses the stored procedure.
CREATE OR REPLACE FUNCTION assert_no_accept_during_open_auction()
RETURNS TRIGGER AS $$
DECLARE
  v_auction_status VARCHAR(20);
BEGIN
  IF NEW.auction_mode = 'auction'
     AND NEW.status IN ('accepted'::order_status, 'payment_pending'::order_status)
     AND OLD.status IS DISTINCT FROM NEW.status THEN

    SELECT status INTO v_auction_status
      FROM order_auctions WHERE order_id = NEW.id;

    IF v_auction_status IS NULL THEN
      RAISE EXCEPTION
        'Cannot accept auction order %: auction row missing (createAuction failed). Cancel and recreate.',
        NEW.id;
    END IF;

    IF v_auction_status IN ('open', 'scoring') THEN
      RAISE EXCEPTION
        'Cannot accept auction order % while auction is %: wait for the bidding window to close.',
        NEW.id, v_auction_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_accept_during_open_auction ON orders;
CREATE TRIGGER trg_no_accept_during_open_auction
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION assert_no_accept_during_open_auction();

-- ────────────────────────────────────────────────────────────────────────
-- (5a) CHECK I3: locked auction ⇒ orders.rate == orders.agreed_rate
-- ────────────────────────────────────────────────────────────────────────
-- Prevents a future code path or admin fixup from drifting the two columns.
-- Only applies to auction-mode orders that have locked a winner.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_auction_rate_matches;
ALTER TABLE orders
  ADD CONSTRAINT orders_auction_rate_matches
  CHECK (
    auction_mode <> 'auction'
    OR selected_merchant_id IS NULL
    OR (agreed_rate IS NOT NULL AND rate = agreed_rate)
  );

-- ────────────────────────────────────────────────────────────────────────
-- (5b) CHECK I9: auction window must be forward-in-time
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE order_auctions
  DROP CONSTRAINT IF EXISTS order_auctions_window_valid;
ALTER TABLE order_auctions
  ADD CONSTRAINT order_auctions_window_valid
  CHECK (window_closes_at > window_opens_at);

-- ────────────────────────────────────────────────────────────────────────
-- (6) Trigger I5: locked auction must have a winner bid in status='won'
-- ────────────────────────────────────────────────────────────────────────
-- Complements the existing partial UNIQUE index
-- idx_order_bids_one_winner_per_auction. That index enforces "at most one
-- winner"; this trigger enforces "at least one winner when locked".
CREATE OR REPLACE FUNCTION assert_auction_locked_has_winner()
RETURNS TRIGGER AS $$
DECLARE
  v_won INTEGER;
BEGIN
  IF NEW.status = 'locked' THEN
    IF NEW.winning_bid_id IS NULL THEN
      RAISE EXCEPTION 'Auction % locked without winning_bid_id', NEW.id;
    END IF;
    SELECT COUNT(*) INTO v_won
      FROM order_bids
     WHERE id = NEW.winning_bid_id AND status = 'won';
    IF v_won <> 1 THEN
      RAISE EXCEPTION
        'Auction % locked but winning_bid % has no matching order_bids row with status=won',
        NEW.id, NEW.winning_bid_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auction_locked_has_winner ON order_auctions;
CREATE TRIGGER trg_auction_locked_has_winner
  AFTER UPDATE OF status ON order_auctions
  FOR EACH ROW
  WHEN (NEW.status = 'locked' AND OLD.status IS DISTINCT FROM 'locked')
  EXECUTE FUNCTION assert_auction_locked_has_winner();

-- ────────────────────────────────────────────────────────────────────────
-- Comments
-- ────────────────────────────────────────────────────────────────────────
COMMENT ON FUNCTION accept_order_v1(UUID, VARCHAR, UUID, VARCHAR) IS
  'Accept order with full auction awareness. Refuses accept on auction-mode orders unless auction is locked/no_bids/cancelled.';
COMMENT ON FUNCTION assert_no_accept_during_open_auction() IS
  'Belt-and-suspenders: blocks every code path that tries to transition an auction-mode order to accepted/payment_pending while auction is open or missing.';
COMMENT ON FUNCTION assert_auction_locked_has_winner() IS
  'I5: an order_auction in status=locked must reference a winning_bid with status=won.';
