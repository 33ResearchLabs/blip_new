/**
 * Shared auction-resolution logic used by both the per-order finalize
 * endpoint (user/admin-triggered) and the expired-auction sweeper (cron).
 *
 * Keeping this as a pure function lets the sweeper fan out over many
 * orders without duplicating the filter/score/rank/lock pipeline or the
 * careful race handling that `lockAuctionWinner` implements.
 */

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

export type ResolveAuctionResult =
  | {
      status: 'locked';
      winningBidId: string;
      merchantId: string;
      agreedRate: number;
      fiatAmount: number;
      expectedPayoutBase: bigint;
      feeBps: number;
      score: number;
      rejected: number;
    }
  | { status: 'already_locked'; winningBidId: string | null }
  | { status: 'no_bids'; fellBackToBase: true }
  | { status: 'no_valid_bids'; fellBackToBase: true; rejected: number }
  | { status: 'race_lost' }
  | {
      status: 'merchant_claim_during_auction';
      detail?: string;
    }
  | { status: 'window_open'; windowClosesAt: Date }
  | { status: 'order_not_open'; detail?: string }
  | { status: 'not_open'; auctionStatus: string }
  | { status: 'not_found'; detail: string };

/**
 * Run the full resolution pipeline for a single auction.
 *
 * Safe to call from any context. Idempotent: a second call on a
 * locked auction returns `{ status: 'already_locked' }`. A second call
 * during the window returns `{ status: 'window_open' }`.
 */
export async function resolveAuction(orderId: string): Promise<ResolveAuctionResult> {
  const orderRows = await query<OrderRow>(
    `SELECT id, type, crypto_amount, auction_mode, selection_mode, fiat_currency
     FROM orders WHERE id = $1`,
    [orderId],
  );
  const order = orderRows[0];
  if (!order) return { status: 'not_found', detail: 'order_not_found' };
  if (order.auction_mode !== 'auction') {
    return { status: 'not_found', detail: 'order_not_in_auction_mode' };
  }

  const auction = await getAuctionForOrder(orderId);
  if (!auction) return { status: 'not_found', detail: 'no_auction_for_order' };

  if (auction.status === 'locked') {
    return { status: 'already_locked', winningBidId: auction.winning_bid_id };
  }
  if (auction.status !== 'open') {
    return { status: 'not_open', auctionStatus: auction.status };
  }
  if (new Date(auction.window_closes_at).getTime() > Date.now()) {
    return { status: 'window_open', windowClosesAt: auction.window_closes_at };
  }

  const bidRows = await listBidsForAuction(auction.id);
  if (bidRows.length === 0) {
    await markAuctionNoBids(auction.id);
    logger.info('[Auction] No bids — falling back to base price', { orderId });
    return { status: 'no_bids', fellBackToBase: true };
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

  for (const scored of result.ranked) {
    const bidId = idByMerchant[scored.metrics.merchantId];
    if (bidId) {
      await updateBidScore({
        id: bidId,
        score: scored.score,
        breakdown: { ...scored.breakdown },
      });
    }
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
    return {
      status: 'no_valid_bids',
      fellBackToBase: true,
      rejected: result.rejected.length,
    };
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
    if (outcome.reason === 'merchant_claim_mismatch') {
      logger.warn(
        '[Auction] Merchant claim during bidding — cancelling auction, base price stands',
        { orderId, detail: outcome.detail },
      );
      await query(
        `UPDATE order_auctions
            SET status = 'cancelled', updated_at = now()
          WHERE id = $1 AND status IN ('open', 'scoring')`,
        [auction.id],
      );
      return { status: 'merchant_claim_during_auction', detail: outcome.detail };
    }
    if (outcome.reason === 'order_not_open') {
      logger.warn('[Auction] Order not open at finalize time', {
        orderId,
        detail: outcome.detail,
      });
      return { status: 'order_not_open', detail: outcome.detail };
    }
    return { status: 'race_lost' };
  }

  logger.info('[Auction] Locked winner', {
    orderId,
    winningBidId,
    merchantId: result.winner.metrics.merchantId,
    score: result.winner.score,
    agreedRate,
    expectedPayoutBase: payoutBase.toString(),
  });

  return {
    status: 'locked',
    winningBidId,
    merchantId: result.winner.metrics.merchantId,
    agreedRate,
    fiatAmount,
    expectedPayoutBase: payoutBase,
    feeBps: auction.base_fee_bps,
    score: result.winner.score,
    rejected: result.rejected.length,
  };
}
