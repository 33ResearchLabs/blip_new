import { query, queryOne } from '@/lib/db';

export interface OrderBidRow {
  id: string;
  order_id: string;
  auction_id: string;
  merchant_id: string;
  rate: string;
  max_amount: string;
  eta_seconds: number;
  score: string | null;
  score_breakdown: Record<string, number> | null;
  status: 'submitted' | 'filtered' | 'won' | 'lost' | 'expired';
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function insertBid(params: {
  orderId: string;
  auctionId: string;
  merchantId: string;
  rate: number;
  maxAmount: number;
  etaSeconds: number;
}): Promise<OrderBidRow> {
  // ON CONFLICT — one merchant can refine their bid until the window closes.
  const row = await queryOne<OrderBidRow>(
    `INSERT INTO order_bids
       (order_id, auction_id, merchant_id, rate, max_amount, eta_seconds)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (order_id, merchant_id) DO UPDATE
       SET rate = EXCLUDED.rate,
           max_amount = EXCLUDED.max_amount,
           eta_seconds = EXCLUDED.eta_seconds,
           status = 'submitted',
           rejection_reason = NULL,
           updated_at = now()
     RETURNING *`,
    [
      params.orderId,
      params.auctionId,
      params.merchantId,
      params.rate,
      params.maxAmount,
      params.etaSeconds,
    ],
  );
  if (!row) throw new Error('bid_insert_failed');

  // Increment bid_count opportunistically. Not atomic with insert but used
  // only for operator visibility — the source-of-truth count comes from the
  // order_bids table.
  await query(
    `UPDATE order_auctions SET bid_count = bid_count + 1, updated_at = now()
     WHERE id = $1`,
    [params.auctionId],
  );

  return row;
}

export async function listBidsForAuction(auctionId: string): Promise<OrderBidRow[]> {
  return query<OrderBidRow>(
    `SELECT * FROM order_bids WHERE auction_id = $1 AND status = 'submitted'`,
    [auctionId],
  );
}

export async function updateBidScore(params: {
  id: string;
  score: number;
  breakdown: Record<string, number>;
}): Promise<void> {
  await query(
    `UPDATE order_bids
       SET score = $1, score_breakdown = $2::jsonb, updated_at = now()
     WHERE id = $3`,
    [params.score, JSON.stringify(params.breakdown), params.id],
  );
}

export async function rejectBid(params: {
  id: string;
  reason: string;
}): Promise<void> {
  await query(
    `UPDATE order_bids
       SET status = 'filtered', rejection_reason = $1, updated_at = now()
     WHERE id = $2`,
    [params.reason, params.id],
  );
}
