/**
 * BlipScore - Protocol-scored ranking for merchant offers
 *
 * This scoring system is used to rank offers in the Marketplace.
 * The protocol computes a score based on multiple factors; merchants set their own prices.
 *
 * IMPORTANT: Blip never claims "best price". We show "ranked by BlipScore" and allow sorting.
 */

// Score weights configuration - centralized for easy tuning
export const BLIP_SCORE_WEIGHTS = {
  priceCompetitiveness: 0.35, // How competitive is the rate vs market
  merchantRating: 0.25,       // Merchant's rating (1-5 stars)
  completionRate: 0.20,       // % of orders successfully completed
  responseTime: 0.10,         // How fast merchant responds (avg_response_time_mins)
  tradeVolume: 0.10,          // Trading experience/volume tier
} as const;

// Thresholds and normalization constants
export const SCORE_CONSTANTS = {
  // Price competitiveness: how much spread is acceptable
  PRICE_SPREAD_TOLERANCE_PERCENT: 5, // Within 5% of best price gets high score

  // Response time scoring (in minutes)
  EXCELLENT_RESPONSE_MINS: 2,
  GOOD_RESPONSE_MINS: 5,
  ACCEPTABLE_RESPONSE_MINS: 15,

  // Volume tiers (in USDC traded)
  VOLUME_TIER_WHALE: 100000,
  VOLUME_TIER_HIGH: 50000,
  VOLUME_TIER_MEDIUM: 10000,
  VOLUME_TIER_LOW: 1000,

  // Completion rate thresholds
  EXCELLENT_COMPLETION_RATE: 0.98,
  GOOD_COMPLETION_RATE: 0.95,

  // Trust threshold - below this, offers don't appear in "Best Overall"
  TRUST_THRESHOLD_RATING: 3.5,
  TRUST_THRESHOLD_TRADES: 3,
} as const;

export interface MerchantStats {
  rating: number;           // 1-5 stars
  ratingCount: number;      // Number of ratings
  totalTrades: number;      // Total completed trades
  totalVolume: number;      // Total volume traded
  avgResponseTimeMins: number;
  completionRate?: number;  // % of orders completed (0-1), computed from order history
  disputeRate?: number;     // % of orders disputed (0-1), computed from order history
}

export interface OfferForScoring {
  id: string;
  rate: number;
  type: 'buy' | 'sell';
  merchantStats: MerchantStats;
}

export interface BlipScoreBreakdown {
  total: number;                // Final score 0-100
  priceScore: number;           // 0-100
  ratingScore: number;          // 0-100
  completionScore: number;      // 0-100
  responseScore: number;        // 0-100
  volumeScore: number;          // 0-100
  isTrusted: boolean;           // Meets trust threshold
  tier: 'diamond' | 'gold' | 'silver' | 'bronze' | 'unranked';
}

/**
 * Compute price competitiveness score
 * Best price in corridor gets 100, others get scaled score based on spread
 */
function computePriceScore(
  rate: number,
  bestRate: number,
  type: 'buy' | 'sell'
): number {
  if (rate === 0 || bestRate === 0) return 0;

  // For 'buy' offers (user is selling crypto), higher rate is better (more fiat for user)
  // For 'sell' offers (user is buying crypto), lower rate is better (less fiat for user)
  let spreadPercent: number;

  if (type === 'buy') {
    // Higher is better for buy offers
    spreadPercent = ((bestRate - rate) / bestRate) * 100;
  } else {
    // Lower is better for sell offers
    spreadPercent = ((rate - bestRate) / bestRate) * 100;
  }

  // Clamp spread to non-negative
  spreadPercent = Math.max(0, spreadPercent);

  // Score: 100 at 0% spread, linearly decreasing to 0 at TOLERANCE %
  const score = Math.max(0, 100 - (spreadPercent / SCORE_CONSTANTS.PRICE_SPREAD_TOLERANCE_PERCENT) * 100);

  return Math.round(score);
}

/**
 * Compute rating score from merchant's star rating
 */
function computeRatingScore(rating: number, ratingCount: number): number {
  // Normalize rating to 0-100 scale (1-5 stars → 0-100)
  const baseScore = ((rating - 1) / 4) * 100;

  // Apply confidence factor based on number of ratings
  // More ratings = more confident in the score
  const confidenceFactor = Math.min(1, Math.sqrt(ratingCount) / 10);

  // Blend with neutral score (50) based on confidence
  const neutralScore = 50;
  const adjustedScore = neutralScore + (baseScore - neutralScore) * confidenceFactor;

  return Math.round(Math.max(0, Math.min(100, adjustedScore)));
}

/**
 * Compute completion rate score
 * Uses available data or defaults to neutral if unavailable
 */
function computeCompletionScore(stats: MerchantStats): number {
  // If we have explicit completion rate, use it
  if (stats.completionRate !== undefined) {
    const rate = stats.completionRate;
    if (rate >= SCORE_CONSTANTS.EXCELLENT_COMPLETION_RATE) return 100;
    if (rate >= SCORE_CONSTANTS.GOOD_COMPLETION_RATE) return 85;
    if (rate >= 0.90) return 70;
    if (rate >= 0.80) return 50;
    return 30;
  }

  // Estimate from total trades - more trades with good rating = likely good completion
  if (stats.totalTrades === 0) return 50; // Neutral for new merchants

  // Infer from rating: highly rated merchants likely have good completion
  const ratingFactor = stats.rating / 5;
  const volumeFactor = Math.min(1, stats.totalTrades / 50);

  return Math.round(50 + 50 * ratingFactor * volumeFactor);
}

/**
 * Compute response time score
 */
function computeResponseScore(avgResponseMins: number): number {
  if (avgResponseMins <= SCORE_CONSTANTS.EXCELLENT_RESPONSE_MINS) return 100;
  if (avgResponseMins <= SCORE_CONSTANTS.GOOD_RESPONSE_MINS) return 85;
  if (avgResponseMins <= SCORE_CONSTANTS.ACCEPTABLE_RESPONSE_MINS) return 60;
  if (avgResponseMins <= 30) return 40;
  return 20;
}

/**
 * Compute volume tier score
 */
function computeVolumeScore(totalVolume: number, totalTrades: number): number {
  // Combine volume and trade count for a more robust signal
  const volumeScore =
    totalVolume >= SCORE_CONSTANTS.VOLUME_TIER_WHALE ? 100 :
    totalVolume >= SCORE_CONSTANTS.VOLUME_TIER_HIGH ? 80 :
    totalVolume >= SCORE_CONSTANTS.VOLUME_TIER_MEDIUM ? 60 :
    totalVolume >= SCORE_CONSTANTS.VOLUME_TIER_LOW ? 40 : 20;

  const tradeScore =
    totalTrades >= 100 ? 100 :
    totalTrades >= 50 ? 80 :
    totalTrades >= 20 ? 60 :
    totalTrades >= 5 ? 40 : 20;

  // Average of volume and trade scores
  return Math.round((volumeScore + tradeScore) / 2);
}

/**
 * Determine score tier for display
 */
function computeTier(score: number, isTrusted: boolean): BlipScoreBreakdown['tier'] {
  if (!isTrusted) return 'unranked';
  if (score >= 90) return 'diamond';
  if (score >= 75) return 'gold';
  if (score >= 55) return 'silver';
  return 'bronze';
}

/**
 * Check if merchant meets trust threshold
 */
function checkTrustThreshold(stats: MerchantStats): boolean {
  return (
    stats.rating >= SCORE_CONSTANTS.TRUST_THRESHOLD_RATING &&
    stats.totalTrades >= SCORE_CONSTANTS.TRUST_THRESHOLD_TRADES
  );
}

/**
 * Calculate BlipScore for a single offer
 *
 * @param offer - The offer to score
 * @param bestRateInCorridor - The best rate among all offers in the same corridor
 */
export function calculateBlipScore(
  offer: OfferForScoring,
  bestRateInCorridor: number
): BlipScoreBreakdown {
  const { rate, type, merchantStats } = offer;

  // Calculate individual component scores
  const priceScore = computePriceScore(rate, bestRateInCorridor, type);
  const ratingScore = computeRatingScore(merchantStats.rating, merchantStats.ratingCount);
  const completionScore = computeCompletionScore(merchantStats);
  const responseScore = computeResponseScore(merchantStats.avgResponseTimeMins);
  const volumeScore = computeVolumeScore(merchantStats.totalVolume, merchantStats.totalTrades);

  // Weighted total
  const total = Math.round(
    priceScore * BLIP_SCORE_WEIGHTS.priceCompetitiveness +
    ratingScore * BLIP_SCORE_WEIGHTS.merchantRating +
    completionScore * BLIP_SCORE_WEIGHTS.completionRate +
    responseScore * BLIP_SCORE_WEIGHTS.responseTime +
    volumeScore * BLIP_SCORE_WEIGHTS.tradeVolume
  );

  const isTrusted = checkTrustThreshold(merchantStats);
  const tier = computeTier(total, isTrusted);

  return {
    total,
    priceScore,
    ratingScore,
    completionScore,
    responseScore,
    volumeScore,
    isTrusted,
    tier,
  };
}

/**
 * Calculate BlipScores for a list of offers in the same corridor
 * Automatically determines best rate and scores all offers
 */
export function calculateCorridorScores(
  offers: OfferForScoring[]
): Map<string, BlipScoreBreakdown> {
  if (offers.length === 0) return new Map();

  // Group by type to find best rate per type
  const buyOffers = offers.filter(o => o.type === 'buy');
  const sellOffers = offers.filter(o => o.type === 'sell');

  const results = new Map<string, BlipScoreBreakdown>();

  // For buy offers: best rate is HIGHEST (more fiat for user)
  if (buyOffers.length > 0) {
    const bestBuyRate = Math.max(...buyOffers.map(o => o.rate));
    for (const offer of buyOffers) {
      results.set(offer.id, calculateBlipScore(offer, bestBuyRate));
    }
  }

  // For sell offers: best rate is LOWEST (less fiat from user)
  if (sellOffers.length > 0) {
    const bestSellRate = Math.min(...sellOffers.map(o => o.rate));
    for (const offer of sellOffers) {
      results.set(offer.id, calculateBlipScore(offer, bestSellRate));
    }
  }

  return results;
}

/**
 * Sort offers by BlipScore (descending)
 */
export function sortByBlipScore<T extends { blipScore?: BlipScoreBreakdown }>(
  offers: T[]
): T[] {
  return [...offers].sort((a, b) => {
    const scoreA = a.blipScore?.total ?? 0;
    const scoreB = b.blipScore?.total ?? 0;
    return scoreB - scoreA;
  });
}

/**
 * Sort offers by price (best first based on type)
 */
export function sortByPrice<T extends { rate: number; type: 'buy' | 'sell' }>(
  offers: T[]
): T[] {
  return [...offers].sort((a, b) => {
    // Group by type first
    if (a.type !== b.type) {
      return a.type === 'buy' ? -1 : 1;
    }
    // For buy: higher rate is better (user gets more fiat)
    // For sell: lower rate is better (user pays less fiat)
    if (a.type === 'buy') {
      return b.rate - a.rate; // Descending for buy
    } else {
      return a.rate - b.rate; // Ascending for sell
    }
  });
}

/**
 * Sort offers by response time (fastest first)
 */
export function sortBySpeed<T extends { merchantStats?: MerchantStats }>(
  offers: T[]
): T[] {
  return [...offers].sort((a, b) => {
    const timeA = a.merchantStats?.avgResponseTimeMins ?? 999;
    const timeB = b.merchantStats?.avgResponseTimeMins ?? 999;
    return timeA - timeB;
  });
}

/**
 * Sort offers by reliability (completion rate desc, dispute rate asc)
 */
export function sortByReliability<T extends { blipScore?: BlipScoreBreakdown }>(
  offers: T[]
): T[] {
  return [...offers].sort((a, b) => {
    const scoreA = a.blipScore?.completionScore ?? 50;
    const scoreB = b.blipScore?.completionScore ?? 50;
    return scoreB - scoreA;
  });
}

// Export sorting options for UI
export type SortOption = 'best' | 'cheapest' | 'fastest' | 'reliable';

export const SORT_OPTIONS: { value: SortOption; label: string; description: string }[] = [
  { value: 'best', label: 'Best Overall', description: 'Ranked by BlipScore' },
  { value: 'cheapest', label: 'Cheapest', description: 'Best price for you' },
  { value: 'fastest', label: 'Fastest', description: 'Quickest response time' },
  { value: 'reliable', label: 'Most Reliable', description: 'Highest completion rate' },
];
