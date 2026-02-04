/**
 * Reputation System Types and Constants
 *
 * Comprehensive reputation scoring based on:
 * - Reviews and ratings
 * - Order execution (completion rate, speed)
 * - Trading volume
 * - Account age and consistency
 * - Dispute history
 */

// ============================================================================
// TYPES
// ============================================================================

export type EntityType = 'user' | 'merchant';

export interface ReputationScore {
  entity_id: string;
  entity_type: EntityType;

  // Overall score (0-1000)
  total_score: number;

  // Component scores (0-100 each)
  review_score: number;
  execution_score: number;
  volume_score: number;
  consistency_score: number;
  trust_score: number;

  // Tier based on total score
  tier: ReputationTier;

  // Badge earned
  badges: ReputationBadge[];

  // Last calculation timestamp
  calculated_at: Date;
}

export type ReputationTier =
  | 'newcomer'      // 0-199
  | 'bronze'        // 200-399
  | 'silver'        // 400-599
  | 'gold'          // 600-799
  | 'platinum'      // 800-899
  | 'diamond';      // 900+

export type ReputationBadge =
  | 'fast_trader'           // Avg completion time < 15 mins
  | 'high_volume'           // Top 10% by volume
  | 'trusted'               // 50+ completed trades, 0 disputes
  | 'veteran'               // Account > 1 year old
  | 'perfect_rating'        // 5.0 average rating with 10+ reviews
  | 'dispute_free'          // Never had a dispute ruled against them
  | 'consistent'            // 95%+ completion rate over 30 days
  | 'whale'                 // $100k+ total volume
  | 'early_adopter'         // First 1000 users
  | 'arbiter_approved';     // Qualified as arbiter

export interface ReputationBreakdown {
  // Review component details
  reviews: {
    count: number;
    average_rating: number;
    five_star_count: number;
    one_star_count: number;
    recent_trend: 'improving' | 'stable' | 'declining';
  };

  // Execution component details
  execution: {
    total_orders: number;
    completed_orders: number;
    cancelled_orders: number;
    disputed_orders: number;
    completion_rate: number;
    avg_completion_time_mins: number;
    on_time_rate: number; // Completed within expected time
  };

  // Volume component details
  volume: {
    total_volume_usd: number;
    last_30_days_volume: number;
    last_7_days_volume: number;
    avg_order_size: number;
    volume_percentile: number; // Where they rank
  };

  // Consistency component details
  consistency: {
    account_age_days: number;
    active_days_last_30: number;
    longest_inactive_streak: number;
    orders_last_30_days: number;
    activity_score: number;
  };

  // Trust component details
  trust: {
    disputes_raised: number;
    disputes_won: number;
    disputes_lost: number;
    dispute_rate: number; // Disputes / total orders
    kyc_level: number;
    verification_status: string;
  };
}

export interface ReputationHistory {
  id: string;
  entity_id: string;
  entity_type: EntityType;
  total_score: number;
  review_score: number;
  execution_score: number;
  volume_score: number;
  consistency_score: number;
  trust_score: number;
  tier: ReputationTier;
  recorded_at: Date;
}

export interface ReputationEvent {
  id: string;
  entity_id: string;
  entity_type: EntityType;
  event_type: ReputationEventType;
  score_change: number;
  reason: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
}

export type ReputationEventType =
  | 'order_completed'
  | 'order_cancelled'
  | 'order_timeout'      // Timeout cancellation - heavier penalty than regular cancellation
  | 'order_disputed'
  | 'dispute_won'
  | 'dispute_lost'
  | 'review_received'
  | 'badge_earned'
  | 'badge_lost'
  | 'tier_upgraded'
  | 'tier_downgraded'
  | 'manual_adjustment';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Weight of each component in total score calculation
 * Total must equal 1.0
 */
export const REPUTATION_WEIGHTS = {
  REVIEW: 0.30,        // 30% - Reviews and ratings
  EXECUTION: 0.25,     // 25% - Order completion
  VOLUME: 0.15,        // 15% - Trading volume
  CONSISTENCY: 0.15,   // 15% - Account activity
  TRUST: 0.15,         // 15% - Dispute history & KYC
} as const;

/**
 * Tier thresholds (total score out of 1000)
 */
export const TIER_THRESHOLDS = {
  newcomer: 0,
  bronze: 200,
  silver: 400,
  gold: 600,
  platinum: 800,
  diamond: 900,
} as const;

/**
 * Tier display info
 */
export const TIER_INFO: Record<ReputationTier, { name: string; color: string; description: string }> = {
  newcomer: {
    name: 'Newcomer',
    color: '#9CA3AF',
    description: 'Just getting started'
  },
  bronze: {
    name: 'Bronze',
    color: '#CD7F32',
    description: 'Building reputation'
  },
  silver: {
    name: 'Silver',
    color: '#C0C0C0',
    description: 'Established trader'
  },
  gold: {
    name: 'Gold',
    color: '#FFD700',
    description: 'Trusted member'
  },
  platinum: {
    name: 'Platinum',
    color: '#E5E4E2',
    description: 'Elite trader'
  },
  diamond: {
    name: 'Diamond',
    color: '#B9F2FF',
    description: 'Top performer'
  },
};

/**
 * Badge requirements
 */
export const BADGE_REQUIREMENTS = {
  fast_trader: {
    avg_completion_time_mins: 15,
    min_orders: 10,
  },
  high_volume: {
    volume_percentile: 90,
  },
  trusted: {
    min_completed_trades: 50,
    max_disputes_lost: 0,
  },
  veteran: {
    min_account_age_days: 365,
  },
  perfect_rating: {
    min_rating: 5.0,
    min_reviews: 10,
  },
  dispute_free: {
    min_orders: 20,
    disputes_lost: 0,
  },
  consistent: {
    min_completion_rate: 0.95,
    period_days: 30,
    min_orders: 10,
  },
  whale: {
    min_volume_usd: 100000,
  },
  early_adopter: {
    max_user_number: 1000,
  },
  arbiter_approved: {
    min_trades: 10,
    min_account_age_days: 30,
    min_rating: 4.0,
    min_reputation: 100,
  },
} as const;

/**
 * Score calculation parameters
 */
export const SCORE_PARAMS = {
  // Review score params
  REVIEW: {
    BASE_WEIGHT: 20,           // Base score for having any reviews
    RATING_MULTIPLIER: 16,     // (rating - 1) * multiplier (1-5 star = 0-64)
    REVIEW_COUNT_BONUS: 0.5,   // Bonus per review (capped)
    MAX_REVIEW_BONUS: 16,      // Max bonus from review count
    TREND_BONUS: 5,            // Bonus for improving trend
    TREND_PENALTY: -5,         // Penalty for declining trend
  },

  // Execution score params
  EXECUTION: {
    COMPLETION_RATE_WEIGHT: 60,  // Max points for 100% completion
    SPEED_WEIGHT: 20,            // Max points for fast completion
    ON_TIME_WEIGHT: 20,          // Max points for on-time delivery
    DISPUTE_PENALTY: 5,          // Points lost per dispute
    CANCEL_PENALTY: 2,           // Points lost per cancellation
  },

  // Volume score params
  VOLUME: {
    VOLUME_TIERS: [
      { min: 0, max: 1000, points: 20 },
      { min: 1000, max: 5000, points: 40 },
      { min: 5000, max: 25000, points: 60 },
      { min: 25000, max: 100000, points: 80 },
      { min: 100000, max: Infinity, points: 100 },
    ],
    RECENT_ACTIVITY_BONUS: 20,   // Bonus for recent trading
  },

  // Consistency score params
  CONSISTENCY: {
    ACCOUNT_AGE_MAX_DAYS: 365,   // Max days for full age bonus
    ACCOUNT_AGE_WEIGHT: 30,      // Max points from account age
    ACTIVITY_WEIGHT: 40,         // Max points from recent activity
    STREAK_WEIGHT: 30,           // Max points from consistent activity
  },

  // Trust score params
  TRUST: {
    BASE_SCORE: 50,              // Starting trust score
    DISPUTE_WIN_BONUS: 5,        // Bonus per dispute won
    DISPUTE_LOSS_PENALTY: 15,    // Penalty per dispute lost
    KYC_BONUS_PER_LEVEL: 10,     // Bonus per KYC level (max 3)
    VERIFIED_BONUS: 10,          // Bonus for verified status
  },
} as const;

/**
 * Minimum requirements for score calculation
 */
export const MIN_REQUIREMENTS = {
  MIN_ORDERS_FOR_EXECUTION_SCORE: 3,
  MIN_REVIEWS_FOR_REVIEW_SCORE: 1,
  MIN_VOLUME_FOR_VOLUME_SCORE: 100,
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get tier from total score
 */
export function getTierFromScore(score: number): ReputationTier {
  if (score >= TIER_THRESHOLDS.diamond) return 'diamond';
  if (score >= TIER_THRESHOLDS.platinum) return 'platinum';
  if (score >= TIER_THRESHOLDS.gold) return 'gold';
  if (score >= TIER_THRESHOLDS.silver) return 'silver';
  if (score >= TIER_THRESHOLDS.bronze) return 'bronze';
  return 'newcomer';
}

/**
 * Get progress to next tier (0-100%)
 */
export function getProgressToNextTier(score: number): { currentTier: ReputationTier; nextTier: ReputationTier | null; progress: number } {
  const currentTier = getTierFromScore(score);
  const tiers: ReputationTier[] = ['newcomer', 'bronze', 'silver', 'gold', 'platinum', 'diamond'];
  const currentIndex = tiers.indexOf(currentTier);

  if (currentIndex === tiers.length - 1) {
    return { currentTier, nextTier: null, progress: 100 };
  }

  const nextTier = tiers[currentIndex + 1];
  const currentThreshold = TIER_THRESHOLDS[currentTier];
  const nextThreshold = TIER_THRESHOLDS[nextTier];
  const progress = ((score - currentThreshold) / (nextThreshold - currentThreshold)) * 100;

  return { currentTier, nextTier, progress: Math.min(100, Math.max(0, progress)) };
}

/**
 * Format score for display
 */
export function formatScore(score: number): string {
  return Math.round(score).toLocaleString();
}

/**
 * Get badge display info
 */
export const BADGE_INFO: Record<ReputationBadge, { name: string; icon: string; description: string }> = {
  fast_trader: {
    name: 'Fast Trader',
    icon: '⚡',
    description: 'Completes trades in under 15 minutes on average',
  },
  high_volume: {
    name: 'High Volume',
    icon: '📈',
    description: 'Top 10% of traders by volume',
  },
  trusted: {
    name: 'Trusted',
    icon: '🛡️',
    description: '50+ completed trades with no lost disputes',
  },
  veteran: {
    name: 'Veteran',
    icon: '🎖️',
    description: 'Account over 1 year old',
  },
  perfect_rating: {
    name: 'Perfect Rating',
    icon: '⭐',
    description: '5.0 average rating with 10+ reviews',
  },
  dispute_free: {
    name: 'Dispute Free',
    icon: '✅',
    description: '20+ orders with no disputes ruled against',
  },
  consistent: {
    name: 'Consistent',
    icon: '📊',
    description: '95%+ completion rate over 30 days',
  },
  whale: {
    name: 'Whale',
    icon: '🐋',
    description: '$100k+ total trading volume',
  },
  early_adopter: {
    name: 'Early Adopter',
    icon: '🚀',
    description: 'One of the first 1000 users',
  },
  arbiter_approved: {
    name: 'Arbiter Approved',
    icon: '⚖️',
    description: 'Qualified to serve as dispute arbiter',
  },
};
