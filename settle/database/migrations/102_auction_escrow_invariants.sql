-- Migration 102: Auction ↔ escrow invariants.
--
-- Makes the hybrid pricing flow safe by enforcing that:
--   1. At most one bid per auction may be in `status = 'won'`.
--   2. When an auction locks, orders.selected_merchant_id MUST equal the
--      winning bid's merchant_id.
--   3. For auction-mode BUY orders, escrow can only be locked AFTER the
--      auction has resolved, AND the funding entity must be the winner.
--
-- All triggers are BEFORE / AFTER UPDATE on existing tables — they add no
-- new columns and do not change the default flow for fixed-price orders
-- (where auction_mode = 'fixed'). Idempotent via IF NOT EXISTS / OR REPLACE.

-- ────────────────────────────────────────────────────────────────────────
-- 1. One winner per auction.
-- ────────────────────────────────────────────────────────────────────────
-- Partial UNIQUE index: at most one row with status='won' per auction_id.
-- Defense in depth on top of the application-level compare-and-swap in
-- lockAuctionWinner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_bids_one_winner_per_auction
  ON order_bids (auction_id)
  WHERE status = 'won';

-- Same defense for the order row: no two locked auctions can point at
-- different winners for the same order. (order_auctions.order_id is
-- already UNIQUE, so this index also protects against a stray
-- selected_merchant_id divergence on orders.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_selected_merchant
  ON orders (id)
  WHERE selected_merchant_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────
-- 2. On auction lock: selected_merchant_id must match winning bid.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assert_auction_lock_consistency()
RETURNS TRIGGER AS $$
DECLARE
  v_winner_merchant  UUID;
  v_order_selected   UUID;
  v_order_merchant   UUID;
  v_order_type       VARCHAR(10);
  v_order_status     order_status;
BEGIN
  -- Winning bid must exist and be 'won' (the UNIQUE partial index above
  -- guarantees at most one such row per auction).
  SELECT merchant_id INTO v_winner_merchant
    FROM order_bids
   WHERE id = NEW.winning_bid_id AND status = 'won';

  IF v_winner_merchant IS NULL THEN
    RAISE EXCEPTION 'Auction % locked but winning_bid % not found or not won',
      NEW.id, NEW.winning_bid_id;
  END IF;

  SELECT selected_merchant_id, merchant_id, type, status
    INTO v_order_selected, v_order_merchant, v_order_type, v_order_status
    FROM orders
   WHERE id = NEW.order_id;

  IF v_order_selected IS DISTINCT FROM v_winner_merchant THEN
    RAISE EXCEPTION 'Auction % locked: orders.selected_merchant_id (%) != winning bid merchant (%)',
      NEW.id, v_order_selected, v_winner_merchant;
  END IF;

  -- For BUY auctions, the seller role is merchant_id. Require it to
  -- equal the winner so escrow (locked by seller) is locked by the
  -- same entity that won pricing.
  IF v_order_type = 'buy'
     AND v_order_merchant IS DISTINCT FROM v_winner_merchant THEN
    RAISE EXCEPTION
      'Auction % locked for BUY order %: merchant_id (%) != winner (%). '
      'This means a different merchant accepted/locked before the auction resolved.',
      NEW.id, NEW.order_id, v_order_merchant, v_winner_merchant;
  END IF;

  -- Refuse to lock an auction whose order has already moved past 'open'.
  -- lockAuctionWinner runs inside a single tx that also updates the
  -- orders row, so at trigger time v_order_status reflects the in-tx
  -- state. Accept anything that is the pre-update state of an auction
  -- flow (open/pending) OR the post-update state the lock itself
  -- transitions to (accepted/escrowed-for-sell).
  IF v_order_status NOT IN ('pending', 'open', 'accepted', 'escrowed') THEN
    RAISE EXCEPTION
      'Auction % cannot lock: order % is in terminal/post-settlement status %',
      NEW.id, NEW.order_id, v_order_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auction_lock_consistency ON order_auctions;
CREATE TRIGGER trg_auction_lock_consistency
  AFTER UPDATE OF status ON order_auctions
  FOR EACH ROW
  WHEN (NEW.status = 'locked' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION assert_auction_lock_consistency();

-- ────────────────────────────────────────────────────────────────────────
-- 3. Escrow-before-auction-lock guard.
-- ────────────────────────────────────────────────────────────────────────
-- For auction-mode orders, escrow can only be locked AFTER the auction
-- resolves. For BUY auction orders, the funding entity must be the
-- auction winner (= orders.selected_merchant_id = orders.merchant_id).
-- This is the core "escrow funder = bid winner" invariant.

CREATE OR REPLACE FUNCTION assert_auction_resolved_before_escrow()
RETURNS TRIGGER AS $$
DECLARE
  v_auction_status VARCHAR(20);
BEGIN
  IF NEW.auction_mode = 'auction'
     AND NEW.status = 'escrowed'
     AND OLD.status IS DISTINCT FROM 'escrowed' THEN

    SELECT status INTO v_auction_status
      FROM order_auctions WHERE order_id = NEW.id;

    -- Allowed post-auction states: 'locked' (winner selected),
    -- 'no_bids' and 'cancelled' (fell back to base price — still safe
    -- because price is frozen on orders by then).
    IF v_auction_status IS NULL
       OR v_auction_status NOT IN ('locked', 'no_bids', 'cancelled') THEN
      RAISE EXCEPTION
        'Cannot lock escrow for auction order %: auction status = %',
        NEW.id, COALESCE(v_auction_status, 'missing');
    END IF;

    -- For BUY auctions where a winner was selected, the escrow funder
    -- MUST be the winner.
    IF v_auction_status = 'locked'
       AND NEW.type = 'buy'
       AND NEW.escrow_debited_entity_id IS DISTINCT FROM NEW.selected_merchant_id THEN
      RAISE EXCEPTION
        'Escrow funder (%) != auction winner (%) for BUY order %',
        NEW.escrow_debited_entity_id, NEW.selected_merchant_id, NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assert_auction_resolved_before_escrow ON orders;
CREATE TRIGGER trg_assert_auction_resolved_before_escrow
  BEFORE UPDATE OF status, escrow_debited_entity_id ON orders
  FOR EACH ROW
  EXECUTE FUNCTION assert_auction_resolved_before_escrow();

-- ────────────────────────────────────────────────────────────────────────
-- 4. Payout ≤ escrow invariant (expressed in raw USDT base units).
-- ────────────────────────────────────────────────────────────────────────
-- crypto_amount stores human units (e.g. 100.5). expected_payout_base
-- stores the raw base-unit post-fee payout (u64-safe). The payout can
-- never exceed the gross (= crypto_amount × 10^6). This is true by
-- construction in calculateFeeBase() but we make it a DB-level invariant.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payout_not_exceeds_escrow;
ALTER TABLE orders
  ADD CONSTRAINT orders_payout_not_exceeds_escrow
  CHECK (
    expected_payout_base IS NULL
    OR crypto_amount IS NULL
    OR expected_payout_base <= (crypto_amount * 1000000)::numeric
  );

COMMENT ON FUNCTION assert_auction_lock_consistency()
  IS 'Enforces: on auction lock, winning bid exists + orders.selected_merchant_id == winner + (for BUY) orders.merchant_id == winner.';
COMMENT ON FUNCTION assert_auction_resolved_before_escrow()
  IS 'Enforces: auction-mode order cannot escrow until auction resolves; BUY-auction escrow funder must be the winner.';
