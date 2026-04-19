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
     VALUES ($1, $2, $3, $4, $5, now() + ($5 || ' milliseconds')::interval)
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

/**
 * Atomically: mark auction 'scoring' → commit winner + update order →
 * mark auction 'locked'. Returns false if the auction was already finalised.
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
}): Promise<boolean> {
  return transaction(async (client) => {
    // Claim the auction: open → scoring. If another worker got here first, bail.
    const claimed = await client.query(
      `UPDATE order_auctions
         SET status = 'scoring', updated_at = now()
       WHERE id = $1 AND status = 'open'
       RETURNING id`,
      [params.auctionId],
    );
    if (claimed.rowCount === 0) return false;

    // Winner + losers.
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

    // Lock onto the order row. We stamp agreed_rate + fee_bps + fiat_amount
    // so the existing pricing path downstream sees immutable, authoritative
    // values for the rest of the lifecycle.
    await client.query(
      `UPDATE orders
         SET selected_merchant_id = $1,
             merchant_id          = COALESCE(merchant_id, $1),
             agreed_rate          = $2,
             rate                 = $2,
             fiat_amount          = $3,
             fee_bps              = $4,
             expected_payout_base = $5
       WHERE id = $6`,
      [
        params.selectedMerchantId,
        params.agreedRate,
        params.fiatAmount,
        params.feeBps,
        params.expectedPayoutBase.toString(),
        params.orderId,
      ],
    );

    await client.query(
      `UPDATE order_auctions
         SET status = 'locked',
             winning_bid_id = $1,
             updated_at = now()
       WHERE id = $2`,
      [params.winningBidId, params.auctionId],
    );

    return true;
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
