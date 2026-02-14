/**
 * Reputation Score Calculator
 *
 * Calculates comprehensive reputation scores based on:
 * - Reviews and ratings
 * - Order execution metrics
 * - Trading volume
 * - Account consistency
 * - Trust/dispute history
 */
import { REPUTATION_WEIGHTS, SCORE_PARAMS, MIN_REQUIREMENTS, BADGE_REQUIREMENTS, getTierFromScore, } from './types';
// ============================================================================
// SCORE CALCULATORS
// ============================================================================
/**
 * Calculate review component score (0-100)
 */
export function calculateReviewScore(stats) {
    const { REVIEW } = SCORE_PARAMS;
    if (stats.review_count < MIN_REQUIREMENTS.MIN_REVIEWS_FOR_REVIEW_SCORE) {
        // No reviews yet - return baseline
        return 50;
    }
    // Base score for having reviews
    let score = REVIEW.BASE_WEIGHT;
    // Rating score (1-5 stars -> 0-64 points)
    const ratingScore = (stats.average_rating - 1) * REVIEW.RATING_MULTIPLIER;
    score += ratingScore;
    // Review count bonus (capped)
    const reviewBonus = Math.min(stats.review_count * REVIEW.REVIEW_COUNT_BONUS, REVIEW.MAX_REVIEW_BONUS);
    score += reviewBonus;
    // Trend bonus/penalty
    const trend = calculateReviewTrend(stats.recent_reviews);
    if (trend === 'improving') {
        score += REVIEW.TREND_BONUS;
    }
    else if (trend === 'declining') {
        score += REVIEW.TREND_PENALTY;
    }
    return Math.max(0, Math.min(100, score));
}
/**
 * Calculate execution component score (0-100)
 */
export function calculateExecutionScore(stats) {
    const { EXECUTION } = SCORE_PARAMS;
    if (stats.total_orders < MIN_REQUIREMENTS.MIN_ORDERS_FOR_EXECUTION_SCORE) {
        // Not enough orders - return baseline
        return 50;
    }
    let score = 0;
    // Completion rate score (0-60)
    const completionRate = stats.completed_orders / stats.total_orders;
    score += completionRate * EXECUTION.COMPLETION_RATE_WEIGHT;
    // Speed score (0-20) - faster is better
    // Perfect score for < 10 mins, scales down to 0 at 60 mins
    const speedScore = Math.max(0, 1 - (stats.avg_completion_time_mins - 10) / 50);
    score += speedScore * EXECUTION.SPEED_WEIGHT;
    // On-time score (0-20) - estimate based on completion rate
    const estimatedOnTimeRate = Math.max(0.5, completionRate);
    score += estimatedOnTimeRate * EXECUTION.ON_TIME_WEIGHT;
    // Dispute penalty
    score -= stats.disputed_orders * EXECUTION.DISPUTE_PENALTY;
    // Cancellation penalty
    score -= stats.cancelled_orders * EXECUTION.CANCEL_PENALTY;
    return Math.max(0, Math.min(100, score));
}
/**
 * Calculate volume component score (0-100)
 */
export function calculateVolumeScore(stats) {
    const { VOLUME } = SCORE_PARAMS;
    if (stats.total_volume_usd < MIN_REQUIREMENTS.MIN_VOLUME_FOR_VOLUME_SCORE) {
        return 0;
    }
    let score = 0;
    // Volume tier score
    for (const tier of VOLUME.VOLUME_TIERS) {
        if (stats.total_volume_usd >= tier.min && stats.total_volume_usd < tier.max) {
            // Interpolate within tier
            const tierRange = tier.max === Infinity ? 100000 : tier.max - tier.min;
            const positionInTier = (stats.total_volume_usd - tier.min) / tierRange;
            const prevTierPoints = VOLUME.VOLUME_TIERS[VOLUME.VOLUME_TIERS.indexOf(tier) - 1]?.points || 0;
            score = prevTierPoints + positionInTier * (tier.points - prevTierPoints);
            break;
        }
    }
    // Recent activity bonus (traded in last 7 days)
    if (stats.last_7_days_volume > 0) {
        score += VOLUME.RECENT_ACTIVITY_BONUS * (Math.min(stats.last_7_days_volume, 1000) / 1000);
    }
    return Math.max(0, Math.min(100, score));
}
/**
 * Calculate consistency component score (0-100)
 */
export function calculateConsistencyScore(stats) {
    const { CONSISTENCY } = SCORE_PARAMS;
    let score = 0;
    // Account age score (0-30)
    const accountAgeDays = Math.floor((Date.now() - new Date(stats.created_at).getTime()) / (1000 * 60 * 60 * 24));
    const ageScore = Math.min(accountAgeDays / CONSISTENCY.ACCOUNT_AGE_MAX_DAYS, 1);
    score += ageScore * CONSISTENCY.ACCOUNT_AGE_WEIGHT;
    // Activity score (0-40) - based on active days in last 30
    const activityRate = stats.active_days_last_30 / 30;
    score += activityRate * CONSISTENCY.ACTIVITY_WEIGHT;
    // Streak score (0-30) - penalize long inactive periods
    const inactivityPenalty = Math.min(stats.longest_inactive_streak / 30, 1);
    score += (1 - inactivityPenalty) * CONSISTENCY.STREAK_WEIGHT;
    return Math.max(0, Math.min(100, score));
}
/**
 * Calculate trust component score (0-100)
 */
export function calculateTrustScore(stats) {
    const { TRUST } = SCORE_PARAMS;
    // Start with base score
    let score = TRUST.BASE_SCORE;
    // Dispute win bonus
    score += stats.disputes_won * TRUST.DISPUTE_WIN_BONUS;
    // Dispute loss penalty
    score -= stats.disputes_lost * TRUST.DISPUTE_LOSS_PENALTY;
    // KYC bonus
    score += Math.min(stats.kyc_level, 3) * TRUST.KYC_BONUS_PER_LEVEL;
    // Verified status bonus
    if (stats.verification_status === 'verified') {
        score += TRUST.VERIFIED_BONUS;
    }
    return Math.max(0, Math.min(100, score));
}
// ============================================================================
// MAIN CALCULATOR
// ============================================================================
/**
 * Calculate complete reputation score
 */
export function calculateReputationScore(stats) {
    // Calculate component scores
    const reviewScore = calculateReviewScore(stats);
    const executionScore = calculateExecutionScore(stats);
    const volumeScore = calculateVolumeScore(stats);
    const consistencyScore = calculateConsistencyScore(stats);
    const trustScore = calculateTrustScore(stats);
    // Calculate weighted total (0-1000 scale)
    const totalScore = (reviewScore * REPUTATION_WEIGHTS.REVIEW +
        executionScore * REPUTATION_WEIGHTS.EXECUTION +
        volumeScore * REPUTATION_WEIGHTS.VOLUME +
        consistencyScore * REPUTATION_WEIGHTS.CONSISTENCY +
        trustScore * REPUTATION_WEIGHTS.TRUST) *
        10;
    // Determine tier
    const tier = getTierFromScore(totalScore);
    // Calculate badges
    const badges = calculateBadges(stats);
    return {
        entity_id: stats.entity_id,
        entity_type: stats.entity_type,
        total_score: Math.round(totalScore),
        review_score: Math.round(reviewScore),
        execution_score: Math.round(executionScore),
        volume_score: Math.round(volumeScore),
        consistency_score: Math.round(consistencyScore),
        trust_score: Math.round(trustScore),
        tier,
        badges,
        calculated_at: new Date(),
    };
}
/**
 * Calculate detailed breakdown
 */
export function calculateReputationBreakdown(stats) {
    const accountAgeDays = Math.floor((Date.now() - new Date(stats.created_at).getTime()) / (1000 * 60 * 60 * 24));
    const completionRate = stats.total_orders > 0
        ? stats.completed_orders / stats.total_orders
        : 0;
    const disputeRate = stats.total_orders > 0
        ? stats.disputed_orders / stats.total_orders
        : 0;
    return {
        reviews: {
            count: stats.review_count,
            average_rating: stats.average_rating,
            five_star_count: stats.five_star_count,
            one_star_count: stats.one_star_count,
            recent_trend: calculateReviewTrend(stats.recent_reviews),
        },
        execution: {
            total_orders: stats.total_orders,
            completed_orders: stats.completed_orders,
            cancelled_orders: stats.cancelled_orders,
            disputed_orders: stats.disputed_orders,
            completion_rate: completionRate,
            avg_completion_time_mins: stats.avg_completion_time_mins,
            on_time_rate: completionRate, // Simplified
        },
        volume: {
            total_volume_usd: stats.total_volume_usd,
            last_30_days_volume: stats.last_30_days_volume,
            last_7_days_volume: stats.last_7_days_volume,
            avg_order_size: stats.total_orders > 0
                ? stats.total_volume_usd / stats.total_orders
                : 0,
            volume_percentile: stats.volume_percentile,
        },
        consistency: {
            account_age_days: accountAgeDays,
            active_days_last_30: stats.active_days_last_30,
            longest_inactive_streak: stats.longest_inactive_streak,
            orders_last_30_days: stats.orders_last_30_days,
            activity_score: (stats.active_days_last_30 / 30) * 100,
        },
        trust: {
            disputes_raised: stats.disputes_raised,
            disputes_won: stats.disputes_won,
            disputes_lost: stats.disputes_lost,
            dispute_rate: disputeRate,
            kyc_level: stats.kyc_level,
            verification_status: stats.verification_status,
        },
    };
}
// ============================================================================
// BADGE CALCULATOR
// ============================================================================
/**
 * Calculate earned badges
 */
export function calculateBadges(stats) {
    const badges = [];
    const accountAgeDays = Math.floor((Date.now() - new Date(stats.created_at).getTime()) / (1000 * 60 * 60 * 24));
    // Fast trader
    if (stats.avg_completion_time_mins <= BADGE_REQUIREMENTS.fast_trader.avg_completion_time_mins &&
        stats.completed_orders >= BADGE_REQUIREMENTS.fast_trader.min_orders) {
        badges.push('fast_trader');
    }
    // High volume
    if (stats.volume_percentile >= BADGE_REQUIREMENTS.high_volume.volume_percentile) {
        badges.push('high_volume');
    }
    // Trusted
    if (stats.completed_orders >= BADGE_REQUIREMENTS.trusted.min_completed_trades &&
        stats.disputes_lost <= BADGE_REQUIREMENTS.trusted.max_disputes_lost) {
        badges.push('trusted');
    }
    // Veteran
    if (accountAgeDays >= BADGE_REQUIREMENTS.veteran.min_account_age_days) {
        badges.push('veteran');
    }
    // Perfect rating
    if (stats.average_rating >= BADGE_REQUIREMENTS.perfect_rating.min_rating &&
        stats.review_count >= BADGE_REQUIREMENTS.perfect_rating.min_reviews) {
        badges.push('perfect_rating');
    }
    // Dispute free
    if (stats.total_orders >= BADGE_REQUIREMENTS.dispute_free.min_orders &&
        stats.disputes_lost === BADGE_REQUIREMENTS.dispute_free.disputes_lost) {
        badges.push('dispute_free');
    }
    // Consistent
    const completionRate = stats.total_orders > 0
        ? stats.completed_orders / stats.total_orders
        : 0;
    if (completionRate >= BADGE_REQUIREMENTS.consistent.min_completion_rate &&
        stats.orders_last_30_days >= BADGE_REQUIREMENTS.consistent.min_orders) {
        badges.push('consistent');
    }
    // Whale
    if (stats.total_volume_usd >= BADGE_REQUIREMENTS.whale.min_volume_usd) {
        badges.push('whale');
    }
    // Early adopter
    if (stats.user_number && stats.user_number <= BADGE_REQUIREMENTS.early_adopter.max_user_number) {
        badges.push('early_adopter');
    }
    // Arbiter approved
    if (stats.completed_orders >= BADGE_REQUIREMENTS.arbiter_approved.min_trades &&
        accountAgeDays >= BADGE_REQUIREMENTS.arbiter_approved.min_account_age_days &&
        stats.average_rating >= BADGE_REQUIREMENTS.arbiter_approved.min_rating) {
        badges.push('arbiter_approved');
    }
    return badges;
}
// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
/**
 * Calculate review trend from recent reviews
 */
function calculateReviewTrend(recentReviews) {
    if (recentReviews.length < 3) {
        return 'stable';
    }
    // Sort by date descending
    const sorted = [...recentReviews].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    // Get recent vs older average
    const midpoint = Math.floor(sorted.length / 2);
    const recentAvg = sorted.slice(0, midpoint).reduce((sum, r) => sum + r.rating, 0) / midpoint;
    const olderAvg = sorted.slice(midpoint).reduce((sum, r) => sum + r.rating, 0) / (sorted.length - midpoint);
    const diff = recentAvg - olderAvg;
    if (diff > 0.3)
        return 'improving';
    if (diff < -0.3)
        return 'declining';
    return 'stable';
}
/**
 * Calculate score change for an event
 */
export function calculateScoreChangeForEvent(eventType, metadata) {
    switch (eventType) {
        case 'order_completed':
            return 5; // Base points for completing an order
        case 'order_cancelled':
            return -2;
        case 'order_timeout':
            return -5; // Heavier penalty for letting order timeout (worse than regular cancel)
        case 'order_disputed':
            return -5;
        case 'dispute_won':
            return 10;
        case 'dispute_lost':
            return -20;
        case 'review_received':
            const rating = metadata?.rating || 3;
            return (rating - 3) * 3; // -6 to +6 based on rating
        default:
            return 0;
    }
}
