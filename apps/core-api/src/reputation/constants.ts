// Merchant weights: Reliability(40) + Volume(15) + Speed(15) + Liquidity(10) + Trust(20)
export const MERCHANT_WEIGHTS = { reliability: 40, volume: 15, speed: 15, liquidity: 10, trust: 20 };

// User weights: Completion(35) + Payment Speed(20) + Trust(25) + Activity(10) + Consistency(10)
export const USER_WEIGHTS = { completion: 35, payment_speed: 20, trust: 25, activity: 10, consistency: 10 };

// Penalties on 0-1000 scale
export const PENALTIES = {
  cancel_after_match: -50,
  dispute_lost: -100,
  refund: -80,
  timeout: -60,
  mark_paid_not_paid: -150,
  fake_proof: -200,
};

export const VOLUME_TIERS = [
  { max: 10, weight: 0.2 },
  { max: 100, weight: 0.5 },
  { max: Infinity, weight: 1.0 },
];

// Cold start baselines on 0-1000 scale
export const MERCHANT_COLD_START = { threshold: 10, baseline: 400 };
export const USER_COLD_START = { threshold: 5, baseline: 450 };

export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Tiers on 0-1000 scale (matches settle's system)
export const TIERS = {
  diamond: 900,   // 900+
  platinum: 800,  // 800-899
  gold: 600,      // 600-799
  silver: 400,    // 400-599
  bronze: 200,    // 200-399
  newcomer: 0,    // 0-199
};
