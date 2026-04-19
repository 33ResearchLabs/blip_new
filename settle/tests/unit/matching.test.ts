import {
  payoutScore,
  ratingScore,
  successScore,
  speedScore,
  disputePenalty,
  scoreBid,
  rankBids,
  rateImprovementBps,
} from '@/lib/matching/scoring';
import { filterBid } from '@/lib/matching/filters';
import { selectBestBid } from '@/lib/matching/selector';
import type {
  AuctionContext,
  MerchantMetrics,
  RawBid,
} from '@/lib/matching/types';

const BASE_RATE = 3.67;
const BASE_FEE_BPS = 250;

function baseCtx(overrides: Partial<AuctionContext> = {}): AuctionContext {
  return {
    orderId: 'o-1',
    orderType: 'sell',
    cryptoAmount: 100,
    baseRate: BASE_RATE,
    baseFeeBps: BASE_FEE_BPS,
    mode: 'recommended',
    ...overrides,
  };
}

function merchant(id: string, o: Partial<MerchantMetrics> = {}): MerchantMetrics {
  return {
    merchantId: id,
    avgRating: 4.5,
    ratingCount: 50,
    balance: 10_000,
    isOnline: true,
    merchantStatus: 'active',
    trustLevel: 'standard',
    suspendedUntil: null,
    totalOrders: 200,
    completedOrders: 198,
    disputedOrders: 2,
    disputesLost: 1,
    avgCompletionSeconds: 120,
    successRate: 0.99,
    disputeRate: 0.005,
    ...o,
  };
}

describe('rateImprovementBps', () => {
  it('positive when sell bid beats base', () => {
    expect(rateImprovementBps(BASE_RATE * 1.01, BASE_RATE, 'sell')).toBe(100);
  });
  it('negative when sell bid worse than base', () => {
    expect(rateImprovementBps(BASE_RATE * 0.99, BASE_RATE, 'sell')).toBe(-100);
  });
  it('inverted for buy orders', () => {
    expect(rateImprovementBps(BASE_RATE * 0.99, BASE_RATE, 'buy')).toBe(100);
    expect(rateImprovementBps(BASE_RATE * 1.01, BASE_RATE, 'buy')).toBe(-100);
  });
});

describe('payoutScore', () => {
  it('0 at base rate', () => {
    expect(payoutScore(BASE_RATE, BASE_RATE, 'sell')).toBe(0);
  });
  it('0 for worse rate', () => {
    expect(payoutScore(BASE_RATE * 0.99, BASE_RATE, 'sell')).toBe(0);
  });
  it('1 at normalise cap', () => {
    expect(payoutScore(BASE_RATE * 1.02, BASE_RATE, 'sell')).toBe(1);
  });
  it('linear between', () => {
    expect(payoutScore(BASE_RATE * 1.01, BASE_RATE, 'sell')).toBeCloseTo(0.5, 5);
  });
});

describe('ratingScore', () => {
  it('neutral 0.5 when no ratings', () => {
    expect(ratingScore(null, 0)).toBe(0.5);
  });
  it('pulls low-confidence ratings toward 0.5', () => {
    expect(ratingScore(5, 0)).toBe(0.5);
    expect(ratingScore(5, 5)).toBeGreaterThan(0.5);
    expect(ratingScore(5, 5)).toBeLessThan(1);
    expect(ratingScore(5, 10)).toBe(1);
  });
});

describe('successScore', () => {
  it('cold-start returns neutral', () => {
    expect(successScore(1, 2)).toBe(0.5);
  });
  it('returns rate when data exists', () => {
    expect(successScore(0.95, 100)).toBe(0.95);
  });
});

describe('speedScore', () => {
  it('1 for <=30s', () => expect(speedScore(10)).toBe(1));
  it('0 for >=600s', () => expect(speedScore(600)).toBe(0));
  it('linear between', () => expect(speedScore(315)).toBeCloseTo(0.5, 2));
});

describe('disputePenalty', () => {
  it('saturates at 20%', () => {
    expect(disputePenalty(0.20)).toBe(1);
    expect(disputePenalty(0.40)).toBe(1);
  });
  it('scales below saturation', () => {
    expect(disputePenalty(0.10)).toBe(0.5);
  });
});

describe('filterBid', () => {
  const bid: RawBid = { merchantId: 'm', rate: 3.70, maxAmount: 200, etaSeconds: 60 };

  it('accepts a healthy bid', () => {
    expect(filterBid(bid, merchant('m'), baseCtx()).ok).toBe(true);
  });
  it('rejects offline merchants', () => {
    expect(filterBid(bid, merchant('m', { isOnline: false }), baseCtx())).toEqual({
      ok: false, reason: 'offline',
    });
  });
  it('rejects untrusted tier', () => {
    expect(
      filterBid(bid, merchant('m', { trustLevel: 'untrusted' }), baseCtx()).reason,
    ).toBe('trust');
  });
  it('rejects suspended merchants', () => {
    const future = new Date(Date.now() + 60_000);
    expect(
      filterBid(bid, merchant('m', { suspendedUntil: future }), baseCtx()).reason,
    ).toBe('trust');
  });
  it('rejects low success rate (standard tier)', () => {
    expect(
      filterBid(bid, merchant('m', { successRate: 0.80 }), baseCtx()).reason,
    ).toBe('success_rate');
  });
  it('allows cold-start merchants past success gate', () => {
    expect(
      filterBid(bid, merchant('m', { totalOrders: 2, successRate: 0.5 }), baseCtx()).ok,
    ).toBe(true);
  });
  it('rejects high dispute rate', () => {
    expect(
      filterBid(bid, merchant('m', { disputeRate: 0.20 }), baseCtx()).reason,
    ).toBe('dispute_rate');
  });
  it('rejects bait rate (improvement > 2%)', () => {
    const bait: RawBid = { ...bid, rate: BASE_RATE * 1.05 };
    expect(filterBid(bait, merchant('m'), baseCtx()).reason).toBe('deviation');
  });
  it('rejects too-worse rate', () => {
    const bad: RawBid = { ...bid, rate: BASE_RATE * 0.98 };
    expect(filterBid(bad, merchant('m'), baseCtx()).reason).toBe('deviation_worse');
  });
  it('rejects insufficient liquidity', () => {
    expect(
      filterBid(bid, merchant('m', { balance: 10 }), baseCtx()).reason,
    ).toBe('liquidity');
  });
  it('rejects max_amount below order', () => {
    expect(
      filterBid({ ...bid, maxAmount: 10 }, merchant('m'), baseCtx()).reason,
    ).toBe('max_amount');
  });
});

describe('selectBestBid — adversarial scenarios', () => {
  it('scammer with best rate but low trust LOSES to honest merchant', () => {
    const scammer = merchant('scammer', {
      successRate: 0.6, totalOrders: 20, disputeRate: 0.25, trustLevel: 'probation',
    });
    const honest = merchant('honest');
    const bids: RawBid[] = [
      { merchantId: 'scammer', rate: BASE_RATE * 1.019, maxAmount: 200, etaSeconds: 30 },
      { merchantId: 'honest', rate: BASE_RATE * 1.008, maxAmount: 200, etaSeconds: 60 },
    ];
    const result = selectBestBid({
      bids,
      metricsByMerchant: { scammer, honest },
      ctx: baseCtx(),
    });
    expect(result.winner?.metrics.merchantId).toBe('honest');
    expect(result.rejected.find((r) => r.bid.merchantId === 'scammer')).toBeDefined();
  });

  it('bait rate gets hard-filtered out regardless of reputation', () => {
    const whale = merchant('whale');
    const bids: RawBid[] = [
      { merchantId: 'whale', rate: BASE_RATE * 1.10, maxAmount: 200, etaSeconds: 30 },
    ];
    const result = selectBestBid({
      bids, metricsByMerchant: { whale }, ctx: baseCtx(),
    });
    expect(result.winner).toBeNull();
    expect(result.fellBackToBase).toBe(true);
    expect(result.rejected[0]?.reason).toBe('deviation');
  });

  it('FASTEST mode picks fastest even at lower payout', () => {
    const fast = merchant('fast');
    const rich = merchant('rich');
    const bids: RawBid[] = [
      { merchantId: 'fast', rate: BASE_RATE * 1.002, maxAmount: 200, etaSeconds: 15 },
      { merchantId: 'rich', rate: BASE_RATE * 1.019, maxAmount: 200, etaSeconds: 300 },
    ];
    const result = selectBestBid({
      bids,
      metricsByMerchant: { fast, rich },
      ctx: baseCtx({ mode: 'fastest' }),
    });
    expect(result.winner?.metrics.merchantId).toBe('fast');
  });

  it('BEST_VALUE mode picks richer payout when both trustworthy', () => {
    const fast = merchant('fast');
    const rich = merchant('rich');
    const bids: RawBid[] = [
      { merchantId: 'fast', rate: BASE_RATE * 1.002, maxAmount: 200, etaSeconds: 15 },
      { merchantId: 'rich', rate: BASE_RATE * 1.019, maxAmount: 200, etaSeconds: 300 },
    ];
    const result = selectBestBid({
      bids,
      metricsByMerchant: { fast, rich },
      ctx: baseCtx({ mode: 'best_value' }),
    });
    expect(result.winner?.metrics.merchantId).toBe('rich');
  });

  it('all-scammers auction falls back to base (no winner)', () => {
    const a = merchant('a', { trustLevel: 'untrusted' });
    const b = merchant('b', { isOnline: false });
    const c = merchant('c', { successRate: 0.5 });
    const bids: RawBid[] = [
      { merchantId: 'a', rate: BASE_RATE * 1.01, maxAmount: 200, etaSeconds: 30 },
      { merchantId: 'b', rate: BASE_RATE * 1.01, maxAmount: 200, etaSeconds: 30 },
      { merchantId: 'c', rate: BASE_RATE * 1.01, maxAmount: 200, etaSeconds: 30 },
    ];
    const result = selectBestBid({
      bids, metricsByMerchant: { a, b, c }, ctx: baseCtx(),
    });
    expect(result.winner).toBeNull();
    expect(result.fellBackToBase).toBe(true);
    expect(result.rejected).toHaveLength(3);
  });

  it('deterministic tiebreak on equal scores (merchantId asc)', () => {
    const m1 = merchant('alpha');
    const m2 = merchant('beta');
    const bids: RawBid[] = [
      { merchantId: 'beta', rate: BASE_RATE * 1.01, maxAmount: 200, etaSeconds: 60 },
      { merchantId: 'alpha', rate: BASE_RATE * 1.01, maxAmount: 200, etaSeconds: 60 },
    ];
    const result = selectBestBid({
      bids, metricsByMerchant: { alpha: m1, beta: m2 }, ctx: baseCtx(),
    });
    expect(result.winner?.metrics.merchantId).toBe('alpha');
  });
});
