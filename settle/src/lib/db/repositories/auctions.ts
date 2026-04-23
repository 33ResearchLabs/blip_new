import { query, queryOne, transaction } from '@/lib/db';
import type { SelectionMode } from '@/lib/matching/types';

export interface OrderAuctionRow {
  id: string;
  order_id: string;
  mode: SelectionMode;
  base_rate: string;
  base_fee_bps: number;
  window_ms: number;
  window_opens_at: Date;
  window_closes_at: Date;
  status: 'open' | 'scoring' | 'locked' | 'no_bids' | 'cancelled';
  winning_bid_id: string | null;
  bid_count: number;
  rejected_count: number;
  created_at: Date;
  updated_at: Date;
}

export async function createAuction(params: {
  orderId: string;
  mode: SelectionMode;
  baseRate: number;
  baseFeeBps: number;
  windowMs: number;
}): Promise<OrderAuctionRow> {
  const row = await queryOne<OrderAuctionRow>(
    `INSERT INTO order_auctions
       (order_id, mode, base_rate, base_fee_bps, window_ms, window_closes_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($5::text || ' milliseconds')::interval)
     RETURNING *`,
    [params.orderId, params.mode, params.baseRate, params.baseFeeBps, params.windowMs],
  );
  if (!row) throw new Error('auction_insert_failed');

  // Mirror auction_id onto orders for convenience.
  await query(
    `UPDATE orders SET auction_id = $1, auction_mode = 'auction', selection_mode = $2
     WHERE id = $3`,
    [row.id, params.mode, params.orderId],
  );
  return row;
}

export async function getAuctionForOrder(orderId: string): Promise<OrderAuctionRow | null> {
  return queryOne<OrderAuctionRow>(
    `SELECT * FROM order_auctions WHERE order_id = $1`,
    [orderId],
  );
}

export type LockAuctionOutcome =
  | { ok: true }
  | { ok: false; reason: 'race_lost' | 'order_not_open' | 'merchant_claim_mismatch'; detail?: string };

/**
 * Atomically: lock the order row → verify it is still eligible for
 * auction resolution → claim the auction (open→scoring) → mark winner +
 * losers → commit winner onto the order → mark auction locked.
 *
 * Invariants enforced here (mirrored by triggers in migration 102):
 *   - Order must still be in 'pending' / 'open' (no prior accept/escrow).
 *   - Order's existing merchant_id (if any) must equal the chosen winner,
 *     otherwise a different merchant accepted before us — reject the lock.
 *   - For BUY auction orders we overwrite merchant_id with the winner
 *     unconditionally (rather than COALESCE), so the seller role matches
 *     the bid winner and subsequent escrow MUST come from the winner.
 *   - For SELL auction orders the user is seller; merchant_id on the
 *     order is the auction winner but not the escrow funder.
 */
export async function lockAuctionWinner(params: {
  auctionId: string;
  orderId: string;
  winningBidId: string;
  agreedRate: number;
  feeBps: number;
  fiatAmount: number;
  expectedPayoutBase: bigint;
  selectedMerchantId: string;
  rejectedIds: string[];
}): Promise<LockAuctionOutcome> {
  return transaction(async (client) => {
    // 1. Pessimistically lock the order row AND read its current claim
    //    state. No other transaction can UPDATE this row until we commit.
    const orderRes = await client.query<{
      status: string;
      merchant_id: string | null;
      type: 'buy' | 'sell';
      auction_mode: 'fixed' | 'auction';
    }>(
      `SELECT status, merchant_id, type, auction_mode
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [params.orderId],
    );
    if (orderRes.rowCount === 0) {
      return { ok: false, reason: 'order_not_open', detail: 'order_missing' };
    }
    const order = orderRes.rows[0];
    if (order.auction_mode !== 'auction') {
      return { ok: false, reason: 'order_not_open', detail: 'auction_mode_fixed' };
    }
    if (!['pending', 'open'].includes(order.status)) {
      return { ok: false, reason: 'order_not_open', detail: `status_${order.status}` };
    }
    // A merchant accepted / claimed the order during the bidding window.
    // The only safe outcome is rejecting their claim and proceeding with
    // the winner, OR rejecting the auction. We choose the latter: if
    // another merchant got there first, they've already committed to
    // the base price — don't silently overwrite them.
    if (order.merchant_id && order.merchant_id !== params.selectedMerchantId) {
      return {
        ok: false,
        reason: 'merchant_claim_mismatch',
        detail: `order_merchant=${order.merchant_id} winner=${params.selectedMerchantId}`,
      };
    }

    // 2. Claim the auction (compare-and-swap).
    const claimed = await client.query(
      `UPDATE order_auctions
         SET status = 'scoring', updated_at = now()
       WHERE id = $1 AND status = 'open'
       RETURNING id`,
      [params.auctionId],
    );
    if (claimed.rowCount === 0) {
      return { ok: false, reason: 'race_lost' };
    }

    // 3. Winner + losers.
    await client.query(
      `UPDATE order_bids SET status = 'won', updated_at = now()
       WHERE id = $1`,
      [params.winningBidId],
    );
    await client.query(
      `UPDATE order_bids SET status = 'lost', updated_at = now()
       WHERE auction_id = $1 AND id <> $2 AND status = 'submitted'`,
      [params.auctionId, params.winningBidId],
    );
    if (params.rejectedIds.length > 0) {
      await client.query(
        `UPDATE order_bids SET status = 'filtered', updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [params.rejectedIds],
      );
    }

    // 4. Stamp the winning bid onto the order. For BUY orders we force
    //    merchant_id = winner (seller = merchant_id per role matrix); for
    //    SELL orders the user is seller, and merchant_id carries the
    //    winning buyer-merchant — still equals the winner.
    await client.query(
      `UPDATE orders
         SET selected_merchant_id = $1,
             merchant_id          = $1,
             agreed_rate          = $2,
             rate                 = $2,
             fiat_amount          = $3,
             fee_bps              = $4,
             expected_payout_base = $5,
             order_version        = order_version + 1
       WHERE id = $6
         AND status IN ('pending', 'open')`,
      [
        params.selectedMerchantId,
        params.agreedRate,
        params.fiatAmount,
        params.feeBps,
        params.expectedPayoutBase.toString(),
        params.orderId,
      ],
    );

    // 5. Finalize the auction. The AFTER UPDATE trigger
    //    trg_auction_lock_consistency (migration 102) will re-verify
    //    winner/order invariants and abort the tx on any drift.
    await client.query(
      `UPDATE order_auctions
         SET status = 'locked',
             winning_bid_id = $1,
             updated_at = now()
       WHERE id = $2`,
      [params.winningBidId, params.auctionId],
    );

    return { ok: true };
  });
}

export async function markAuctionNoBids(auctionId: string): Promise<void> {
  await query(
    `UPDATE order_auctions
       SET status = 'no_bids', updated_at = now()
     WHERE id = $1 AND status = 'open'`,
    [auctionId],
  );
}
