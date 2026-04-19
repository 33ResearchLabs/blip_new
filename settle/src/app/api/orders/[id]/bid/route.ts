import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  forbiddenResponse,
  validationErrorResponse,
  errorResponse,
  successResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit, ORDER_LIMIT } from '@/lib/middleware/rateLimit';
import { submitBidSchema } from '@/lib/validation/schemas';
import { getAuctionForOrder } from '@/lib/db/repositories/auctions';
import { insertBid } from '@/lib/db/repositories/bids';
import { getMetricsForMerchant } from '@/lib/db/repositories/merchantMetrics';
import { filterBid } from '@/lib/matching/filters';
import type { AuctionContext } from '@/lib/matching/types';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';

interface OrderRow {
  id: string;
  type: 'buy' | 'sell';
  crypto_amount: string;
  auction_mode: 'fixed' | 'auction';
  selection_mode: AuctionContext['mode'] | null;
}

/**
 * POST /api/orders/:id/bid
 *
 * Merchants submit (or refresh) their quote for an auctioned order. Same
 * merchant resubmitting before the window closes updates their bid in
 * place. Pre-filtered with the same rules the selector will apply so
 * doomed bids fail fast with a useful error.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;
  const rateLimitResponse = await checkRateLimit(request, 'orders:bid', ORDER_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'merchant') {
    return forbiddenResponse('Only merchants can submit bids');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse(['Invalid JSON body']);
  }

  const parsed = submitBidSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(
      parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    );
  }
  const { merchant_id, rate, max_amount, eta_seconds } = parsed.data;

  // Auth: merchant can only bid as themselves.
  if (merchant_id !== auth.actorId) {
    return forbiddenResponse('Cannot bid on behalf of another merchant');
  }

  try {
    // Order + auction must both exist and still be open.
    const orderRows = await query<OrderRow>(
      `SELECT id, type, crypto_amount, auction_mode, selection_mode
       FROM orders WHERE id = $1`,
      [orderId],
    );
    const order = orderRows[0];
    if (!order) return validationErrorResponse(['Order not found']);
    if (order.auction_mode !== 'auction') {
      return validationErrorResponse(['Order is not in auction mode']);
    }

    const auction = await getAuctionForOrder(orderId);
    if (!auction) return validationErrorResponse(['No active auction for this order']);
    if (auction.status !== 'open') {
      return NextResponse.json(
        { success: false, error: 'auction_closed', status: auction.status },
        { status: 409 },
      );
    }
    if (new Date(auction.window_closes_at).getTime() <= Date.now()) {
      return NextResponse.json(
        { success: false, error: 'window_closed' },
        { status: 409 },
      );
    }

    // Filter the bid before accepting it — gives merchants an actionable
    // rejection (and keeps the bids table clean of doomed rows).
    const metrics = await getMetricsForMerchant(merchant_id);
    if (!metrics) return validationErrorResponse(['Merchant metrics unavailable']);

    const auctionCtx: AuctionContext = {
      orderId,
      orderType: order.type,
      cryptoAmount: Number(order.crypto_amount),
      baseRate: Number(auction.base_rate),
      baseFeeBps: auction.base_fee_bps,
      mode: (order.selection_mode ?? auction.mode) as AuctionContext['mode'],
    };

    const decision = filterBid(
      { merchantId: merchant_id, rate, maxAmount: max_amount, etaSeconds: eta_seconds },
      metrics,
      auctionCtx,
    );
    if (!decision.ok) {
      return NextResponse.json(
        {
          success: false,
          error: 'bid_rejected',
          reason: decision.reason,
          detail: decision.detail,
        },
        { status: 422 },
      );
    }

    const row = await insertBid({
      orderId,
      auctionId: auction.id,
      merchantId: merchant_id,
      rate,
      maxAmount: max_amount,
      etaSeconds: eta_seconds,
    });

    logger.info('[Auction] Bid accepted', {
      orderId,
      merchantId: merchant_id,
      rate,
      etaSeconds: eta_seconds,
    });

    return successResponse({
      bid_id: row.id,
      auction_id: auction.id,
      window_closes_at: auction.window_closes_at,
    });
  } catch (err) {
    logger.error('[Auction] Bid submission failed', {
      orderId,
      merchantId: merchant_id,
      err: (err as Error).message,
    });
    return errorResponse('Failed to submit bid');
  }
}
