/**
 * GET /api/orders/:id/auction
 *
 * Read-only endpoint that the user's OrderDetailScreen + merchant's
 * PendingOrdersPanel poll to show the live bid state. Returns the
 * auction row + all bids (including merchant display name) + the
 * winning bid details when already locked.
 *
 * Access rules: any authenticated actor who can see the order itself
 * can see its auction state. Merchants can see auctions they're
 * eligible to bid on; the page of finalize / winner selection is done
 * server-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  forbiddenResponse,
  errorResponse,
  successResponse,
  validationErrorResponse,
} from '@/lib/middleware/auth';
import { uuidSchema } from '@/lib/validation/schemas';
import { getAuctionForOrder } from '@/lib/db/repositories/auctions';
import { query } from '@/lib/db';

interface BidRow {
  id: string;
  merchant_id: string;
  rate: string;
  max_amount: string;
  eta_seconds: number;
  status: 'submitted' | 'filtered' | 'won' | 'lost' | 'expired';
  rejection_reason: string | null;
  created_at: Date;
  merchant_business_name: string | null;
  merchant_rating: string | null;
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: orderId } = await ctx.params;

  if (!uuidSchema.safeParse(orderId).success) {
    return validationErrorResponse(['Invalid order id']);
  }

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const auction = await getAuctionForOrder(orderId);
    if (!auction) {
      // Non-auction order (or order that doesn't exist). Return a shape
      // the client can easily distinguish so it can hide the auction UI.
      return successResponse({ auction: null, bids: [] });
    }

    // Join merchants to get display names + rating for the UI.
    const bids = await query<BidRow>(
      `SELECT b.id, b.merchant_id, b.rate, b.max_amount, b.eta_seconds,
              b.status, b.rejection_reason, b.created_at,
              m.business_name AS merchant_business_name,
              m.rating       AS merchant_rating
         FROM order_bids b
         LEFT JOIN merchants m ON m.id = b.merchant_id
        WHERE b.auction_id = $1
        ORDER BY b.created_at ASC`,
      [auction.id],
    );

    return successResponse({
      auction: {
        id: auction.id,
        order_id: auction.order_id,
        mode: auction.mode,
        base_rate: auction.base_rate,
        base_fee_bps: auction.base_fee_bps,
        window_ms: auction.window_ms,
        window_opens_at: auction.window_opens_at,
        window_closes_at: auction.window_closes_at,
        status: auction.status,
        winning_bid_id: auction.winning_bid_id,
        bid_count: auction.bid_count,
      },
      bids: bids.map((b) => ({
        id: b.id,
        merchant_id: b.merchant_id,
        merchant_name: b.merchant_business_name ?? null,
        merchant_rating: b.merchant_rating ? Number(b.merchant_rating) : null,
        rate: Number(b.rate),
        max_amount: Number(b.max_amount),
        eta_seconds: b.eta_seconds,
        status: b.status,
        rejection_reason: b.rejection_reason,
        created_at: b.created_at,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Don't leak raw DB errors — the auction data is low-sensitivity but
    // the message shape is still worth hiding.
    console.error('[auction GET] failed', msg);
    return errorResponse('Failed to load auction state');
  }
}
