import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  forbiddenResponse,
  validationErrorResponse,
  errorResponse,
  successResponse,
} from '@/lib/middleware/auth';
import { query } from '@/lib/db';
import {
  getAuctionForOrder,
  lockAuctionWinner,
  markAuctionNoBids,
} from '@/lib/db/repositories/auctions';
import { listBidsForAuction, rejectBid, updateBidScore } from '@/lib/db/repositories/bids';
import { getMetricsForMerchants } from '@/lib/db/repositories/merchantMetrics';
import { selectBestBid } from '@/lib/matching/selector';
import type { AuctionContext, RawBid } from '@/lib/matching/types';
import { calculateFeeBase, toBaseUnits, USDT_DECIMALS } from '@/lib/money/payout';
import { logger } from '@/lib/logger';

interface OrderRow {
  id: string;
  type: 'buy' | 'sell';
  crypto_amount: string;
  auction_mode: 'fixed' | 'auction';
  selection_mode: AuctionContext['mode'] | null;
  fiat_currency: string | null;
}

/**
 * POST /api/orders/:id/finalize-auction
 *
 * Run the filter + score + rank pipeline over all submitted bids and lock
 * the winner onto the order. Idempotent: if already locked, returns the
 * existing result. Permissioned to:
 *   - the order's user
 *   - any authenticated merchant (safe — the selection logic is independent)
 *   - admin token
 *
 * Typically called either by a worker shortly after `window_closes_at` or
 * by the user's client once the window has elapsed. A race between callers
 * resolves atomically inside `lockAuctionWinner`.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await ctx.params;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const orderRows = await query<OrderRow>(
      `SELECT id, type, crypto_amount, auction_mode, selection_mode, fiat_currency
       FROM orders WHERE id = $1`,
      [orderId],
    );
    const order = orderRows[0];
    if (!order) return validationErrorResponse(['Order not found']);
    if (order.auction_mode !== 'auction') {
      return validationErrorResponse(['Order is not in auction mode']);
    }

    const auction = await getAuctionForOrder(orderId);
    if (!auction) return validationErrorResponse(['No auction for this order']);

    // Only the user owns this action; merchants other than the bidders
    // should not trigger early finalisation. Admin may force.
    const isUser = auth.actorType === 'user';
    const isAdmin = (auth as any).actorType === 'admin';
    if (!isUser && !isAdmin) {
      return forbiddenResponse('Only the order user or admin can finalize');
    }

    if (auction.status === 'locked') {
      return successResponse({ status: 'already_locked', winning_bid_id: auction.winning_bid_id });
    }
    if (auction.status !== 'open') {
      return NextResponse.json(
        { success: false, error: 'not_open', status: auction.status },
        { status: 409 },
      );
    }
    if (new Date(auction.window_closes_at).getTime() > Date.now()) {
      return NextResponse.json(
        { success: false, error: 'window_open', window_closes_at: auction.window_closes_at },
        { status: 425 },
      );
    }

    const bidRows = await listBidsForAuction(auction.id);

    if (bidRows.length === 0) {
      await markAuctionNoBids(auction.id);
      logger.info('[Auction] No bids — falling back to base price', { orderId });
      return successResponse({ status: 'no_bids', fell_back_to_base: true });
    }

    const rawBids: RawBid[] = bidRows.map((b) => ({
      merchantId: b.merchant_id,
      rate: Number(b.rate),
      maxAmount: Number(b.max_amount),
      etaSeconds: b.eta_seconds,
    }));
    const idByMerchant = Object.fromEntries(bidRows.map((b) => [b.merchant_id, b.id]));

    const metricsByMerchant = await getMetricsForMerchants(rawBids.map((b) => b.merchantId));

    const auctionCtx: AuctionContext = {
      orderId,
      orderType: order.type,
      cryptoAmount: Number(order.crypto_amount),
      baseRate: Number(auction.base_rate),
      baseFeeBps: auction.base_fee_bps,
      mode: (order.selection_mode ?? auction.mode) as AuctionContext['mode'],
    };

    const result = selectBestBid({ bids: rawBids, metricsByMerchant, ctx: auctionCtx });

    // Write scoring breakdown to the bid rows for audit.
    for (const scored of result.ranked) {
      await updateBidScore({
        id: idByMerchant[scored.metrics.merchantId]!,
        score: scored.score,
        breakdown: { ...scored.breakdown },
      });
    }
    for (const r of result.rejected) {
      const bidId = idByMerchant[r.bid.merchantId];
      if (bidId) await rejectBid({ id: bidId, reason: r.reason });
    }

    if (!result.winner) {
      await markAuctionNoBids(auction.id);
      logger.info('[Auction] All bids filtered out — falling back to base', {
        orderId,
        rejected: result.rejected.length,
      });
      return successResponse({
        status: 'no_valid_bids',
        fell_back_to_base: true,
        rejected: result.rejected,
      });
    }

    const winningBidId = idByMerchant[result.winner.metrics.merchantId]!;
    const agreedRate = result.winner.raw.rate;
    const cryptoAmount = Number(order.crypto_amount);
    const fiatAmount = cryptoAmount * agreedRate;
    const grossBase = toBaseUnits(cryptoAmount.toString(), USDT_DECIMALS);
    const { payoutBase } = calculateFeeBase(grossBase, auction.base_fee_bps);

    const outcome = await lockAuctionWinner({
      auctionId: auction.id,
      orderId,
      winningBidId,
      agreedRate,
      feeBps: auction.base_fee_bps,
      fiatAmount,
      expectedPayoutBase: payoutBase,
      selectedMerchantId: result.winner.metrics.merchantId,
      rejectedIds: result.rejected
        .map((r) => idByMerchant[r.bid.merchantId])
        .filter((x): x is string => Boolean(x)),
    });

    if (!outcome.ok) {
      const fresh = await getAuctionForOrder(orderId);

      // A merchant claimed the order during the bidding window. The
      // auction cannot safely overwrite pricing for a committed
      // merchant, so we fall back to the base price on the existing
      // claim and mark the auction cancelled.
      if (outcome.reason === 'merchant_claim_mismatch') {
        logger.warn('[Auction] Merchant claim during bidding — cancelling auction, base price stands', {
          orderId,
          detail: outcome.detail,
        });
        await query(
          `UPDATE order_auctions
              SET status = 'cancelled', updated_at = now()
            WHERE id = $1 AND status IN ('open', 'scoring')`,
          [auction.id],
        );
        return NextResponse.json(
          {
            success: false,
            error: 'merchant_claim_during_auction',
            code: 'AUCTION_CANCELLED_BY_CLAIM',
            detail: outcome.detail,
            fell_back_to_base: true,
          },
          { status: 409 },
        );
      }

      // Order was no longer open (expired, cancelled, or already
      // moved past 'open' by some other path): surface and stop.
      if (outcome.reason === 'order_not_open') {
        logger.warn('[Auction] Order not open at finalize time', {
          orderId,
          detail: outcome.detail,
        });
        return NextResponse.json(
          { success: false, error: 'order_not_open', detail: outcome.detail },
          { status: 409 },
        );
      }

      // race_lost: another worker finalized first. Idempotent success.
      return successResponse({
        status: 'race_lost',
        current_status: fresh?.status,
        winning_bid_id: fresh?.winning_bid_id,
      });
    }

    logger.info('[Auction] Locked winner', {
      orderId,
      winningBidId,
      merchantId: result.winner.metrics.merchantId,
      score: result.winner.score,
      agreedRate,
      expectedPayoutBase: payoutBase.toString(),
    });

    return successResponse({
      status: 'locked',
      winning_bid_id: winningBidId,
      merchant_id: result.winner.metrics.merchantId,
      agreed_rate: agreedRate,
      fiat_amount: fiatAmount,
      expected_payout_base: payoutBase.toString(),
      fee_bps: auction.base_fee_bps,
      score: result.winner.score,
      breakdown: result.winner.breakdown,
      rejected: result.rejected,
    });
  } catch (err) {
    logger.error('[Auction] Finalize failed', {
      orderId,
      err: (err as Error).message,
    });
    return errorResponse('Failed to finalize auction');
  }
}
