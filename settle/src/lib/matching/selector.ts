/**
 * Orchestrates filter + score + rank. Pure. Takes raw bids + merchant
 * metrics + auction context; returns winner + rejection log.
 *
 * The caller is responsible for persistence. No I/O here.
 */

import { filterBid } from './filters';
import { rankBids, scoreBid } from './scoring';
import type {
  AuctionContext,
  MerchantMetrics,
  RawBid,
  SelectionResult,
} from './types';

export interface SelectBidsInput {
  bids: RawBid[];
  metricsByMerchant: Record<string, MerchantMetrics>;
  ctx: AuctionContext;
}

export function selectBestBid(input: SelectBidsInput): SelectionResult {
  const { bids, metricsByMerchant, ctx } = input;

  const rejected: SelectionResult['rejected'] = [];
  const passing: Array<{ raw: RawBid; metrics: MerchantMetrics }> = [];

  for (const raw of bids) {
    const metrics = metricsByMerchant[raw.merchantId];
    if (!metrics) {
      rejected.push({ bid: raw, reason: 'status', detail: 'no_metrics' });
      continue;
    }
    const decision = filterBid(raw, metrics, ctx);
    if (!decision.ok) {
      rejected.push({ bid: raw, reason: decision.reason!, detail: decision.detail });
      continue;
    }
    passing.push({ raw, metrics });
  }

  if (passing.length === 0) {
    return { winner: null, ranked: [], rejected, fellBackToBase: true };
  }

  const scored = passing.map(({ raw, metrics }) => scoreBid(raw, metrics, ctx));
  const ranked = rankBids(scored);
  const winner = ranked[0] ?? null;

  return { winner, ranked, rejected, fellBackToBase: winner === null };
}
