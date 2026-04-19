/**
 * Shared types for the auction/matching engine. Purely declarative — no
 * side effects, no imports beyond `@/lib/money/payout`.
 */

import type { Phase } from '@/lib/money/payout';

export type SelectionMode = 'fastest' | 'recommended' | 'best_value';
export type OrderType = 'buy' | 'sell';

export type BidStatus = 'submitted' | 'filtered' | 'won' | 'lost' | 'expired';

export type RejectionReason =
  | 'success_rate'        // below MIN_SUCCESS_THRESHOLD
  | 'trust'               // untrusted or suspended
  | 'max_amount'          // merchant cap smaller than order
  | 'liquidity'           // merchant balance < required
  | 'deviation'           // rate improvement > MAX_DEVIATION_BPS (bait)
  | 'deviation_worse'     // rate worse than base — not auction-worthy
  | 'dispute_rate'        // above MAX_DISPUTE_RATE
  | 'offline'             // merchant offline
  | 'status';             // merchant row not active

export interface RawBid {
  merchantId: string;
  rate: number;         // fiat per 1 USDT
  maxAmount: number;    // USDT (display units), merchant-declared cap
  etaSeconds: number;   // merchant-declared SLA
}

/** Row shape returned by v_merchant_scoring. */
export interface MerchantMetrics {
  merchantId: string;
  avgRating: number | null;         // 0..5
  ratingCount: number;
  balance: number;                  // USDT display units
  isOnline: boolean;
  merchantStatus: string;           // merchants.status enum
  trustLevel: 'untrusted' | 'probation' | 'standard' | 'trusted';
  suspendedUntil: Date | null;
  totalOrders: number;
  completedOrders: number;
  disputedOrders: number;
  disputesLost: number;
  avgCompletionSeconds: number;
  successRate: number;              // 0..1
  disputeRate: number;              // 0..1
}

export interface AuctionContext {
  orderId: string;
  orderType: OrderType;
  cryptoAmount: number;             // USDT display units, the amount being traded
  baseRate: number;                 // reference rate from getFinalPrice
  baseFeeBps: number;               // reference fee from getCurrentFeeBps
  mode: SelectionMode;
}

export interface ScoreBreakdown {
  payout: number;      // 0..1
  rating: number;      // 0..1
  success: number;     // 0..1
  speed: number;       // 0..1
  dispute: number;     // 0..1 (penalty)
}

export interface ScoredBid {
  raw: RawBid;
  metrics: MerchantMetrics;
  score: number;                    // final weighted score (higher is better)
  breakdown: ScoreBreakdown;
}

export interface FilterDecision {
  ok: boolean;
  reason?: RejectionReason;
  detail?: string;
}

export interface SelectionResult {
  winner: ScoredBid | null;
  ranked: ScoredBid[];              // sorted desc by score
  rejected: Array<{ bid: RawBid; reason: RejectionReason; detail?: string }>;
  fellBackToBase: boolean;
}

/** Hydrated UI view of an auctioned order — bridged via @/lib/money/payout. */
export interface AuctionAmountInput {
  phase: Phase;
  cryptoAmount: number;
  feeBps: number;
  rate: number;                     // base or agreed, per phase
  fiatCurrency: string;
  selectedMerchant?: {
    id: string;
    displayName: string;
    rating: number | null;
    etaSeconds: number;
  };
}
