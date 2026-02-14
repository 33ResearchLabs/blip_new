/**
 * Reputation Repository
 *
 * Database operations for reputation system
 */
import { query, queryOne } from '../db';
import { calculateReputationScore, calculateReputationBreakdown, calculateScoreChangeForEvent, } from './calculator';
// ============================================================================
// TABLE INITIALIZATION
// ============================================================================
/**
 * Initialize reputation tables
 */
export async function initializeReputationTables() {
    await query(`
    -- Reputation scores table (current scores)
    CREATE TABLE IF NOT EXISTS reputation_scores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id UUID NOT NULL,
      entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('user', 'merchant')),
      total_score INTEGER NOT NULL DEFAULT 0,
      review_score INTEGER NOT NULL DEFAULT 50,
      execution_score INTEGER NOT NULL DEFAULT 50,
      volume_score INTEGER NOT NULL DEFAULT 0,
      consistency_score INTEGER NOT NULL DEFAULT 0,
      trust_score INTEGER NOT NULL DEFAULT 50,
      tier VARCHAR(20) NOT NULL DEFAULT 'newcomer',
      badges TEXT[] DEFAULT '{}',
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(entity_id, entity_type)
    );

    -- Reputation history (daily snapshots)
    CREATE TABLE IF NOT EXISTS reputation_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id UUID NOT NULL,
      entity_type VARCHAR(20) NOT NULL,
      total_score INTEGER NOT NULL,
      review_score INTEGER NOT NULL,
      execution_score INTEGER NOT NULL,
      volume_score INTEGER NOT NULL,
      consistency_score INTEGER NOT NULL,
      trust_score INTEGER NOT NULL,
      tier VARCHAR(20) NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Reputation events (audit log)
    CREATE TABLE IF NOT EXISTS reputation_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id UUID NOT NULL,
      entity_type VARCHAR(20) NOT NULL,
      event_type VARCHAR(50) NOT NULL,
      score_change INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_reputation_scores_entity
      ON reputation_scores(entity_id, entity_type);
    CREATE INDEX IF NOT EXISTS idx_reputation_scores_tier
      ON reputation_scores(tier);
    CREATE INDEX IF NOT EXISTS idx_reputation_scores_total
      ON reputation_scores(total_score DESC);
    CREATE INDEX IF NOT EXISTS idx_reputation_history_entity
      ON reputation_history(entity_id, entity_type);
    CREATE INDEX IF NOT EXISTS idx_reputation_history_date
      ON reputation_history(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_reputation_events_entity
      ON reputation_events(entity_id, entity_type);
    CREATE INDEX IF NOT EXISTS idx_reputation_events_type
      ON reputation_events(event_type);
  `);
}
// ============================================================================
// STATS FETCHING
// ============================================================================
/**
 * Fetch all stats needed for reputation calculation
 */
export async function getEntityStats(entityId, entityType) {
    if (entityType === 'user') {
        return getUserStats(entityId);
    }
    else {
        return getMerchantStats(entityId);
    }
}
/**
 * Fetch user stats
 */
async function getUserStats(userId) {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user)
        return null;
    // Get order stats
    const orderStats = await queryOne(`SELECT
      COUNT(*)::int as total_orders,
      COUNT(*) FILTER (WHERE status = 'completed')::int as completed_orders,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int as cancelled_orders,
      COUNT(*) FILTER (WHERE status = 'disputed')::int as disputed_orders,
      COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60)
        FILTER (WHERE status = 'completed'), 30)::int as avg_completion_mins,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int as orders_last_30_days,
      COALESCE(SUM(fiat_amount) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'), 0)::numeric as volume_last_30_days,
      COALESCE(SUM(fiat_amount) FILTER (WHERE created_at > NOW() - INTERVAL '7 days'), 0)::numeric as volume_last_7_days
    FROM orders WHERE user_id = $1`, [userId]);
    // Get review stats
    const reviewStats = await queryOne(`SELECT
      COUNT(*)::int as review_count,
      COALESCE(AVG(rating), 0)::numeric as average_rating,
      COUNT(*) FILTER (WHERE rating = 5)::int as five_star_count,
      COUNT(*) FILTER (WHERE rating = 1)::int as one_star_count
    FROM reviews WHERE reviewee_id = $1 AND reviewee_type = 'user'`, [userId]);
    // Get recent reviews for trend
    const recentReviews = await query(`SELECT rating, created_at FROM reviews
     WHERE reviewee_id = $1 AND reviewee_type = 'user'
     ORDER BY created_at DESC LIMIT 10`, [userId]);
    // Get dispute stats
    const disputeStats = await queryOne(`SELECT
      COUNT(*)::int as disputes_raised,
      COUNT(*) FILTER (WHERE resolved_in_favor_of = 'user')::int as disputes_won,
      COUNT(*) FILTER (WHERE resolved_in_favor_of = 'merchant')::int as disputes_lost
    FROM disputes d
    JOIN orders o ON d.order_id = o.id
    WHERE o.user_id = $1 AND d.raiser_id = $1`, [userId]);
    // Get activity stats
    const activityStats = await queryOne(`WITH daily_activity AS (
      SELECT DATE(created_at) as activity_date
      FROM orders WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
    )
    SELECT
      COUNT(*)::int as active_days,
      COALESCE(MAX(gap_days), 0)::int as longest_inactive
    FROM (
      SELECT
        activity_date,
        EXTRACT(DAY FROM activity_date - LAG(activity_date) OVER (ORDER BY activity_date))::int as gap_days
      FROM daily_activity
    ) gaps`, [userId]);
    // Get volume percentile
    const volumePercentile = await queryOne(`SELECT PERCENT_RANK() OVER (ORDER BY total_volume) * 100 as percentile
     FROM users WHERE id = $1`, [userId]);
    // Get user number for early adopter
    const userNumber = await queryOne(`SELECT ROW_NUMBER() OVER (ORDER BY created_at) as row_num
     FROM users WHERE id = $1`, [userId]);
    return {
        entity_id: userId,
        entity_type: 'user',
        created_at: user.created_at,
        kyc_level: user.kyc_level || 0,
        verification_status: user.kyc_status || 'none',
        total_orders: orderStats?.total_orders || 0,
        completed_orders: orderStats?.completed_orders || 0,
        cancelled_orders: orderStats?.cancelled_orders || 0,
        disputed_orders: orderStats?.disputed_orders || 0,
        avg_completion_time_mins: orderStats?.avg_completion_mins || 30,
        total_volume_usd: Number(user.total_volume) || 0,
        last_30_days_volume: Number(orderStats?.volume_last_30_days) || 0,
        last_7_days_volume: Number(orderStats?.volume_last_7_days) || 0,
        review_count: reviewStats?.review_count || 0,
        average_rating: Number(reviewStats?.average_rating) || 0,
        five_star_count: reviewStats?.five_star_count || 0,
        one_star_count: reviewStats?.one_star_count || 0,
        recent_reviews: recentReviews || [],
        disputes_raised: disputeStats?.disputes_raised || 0,
        disputes_won: disputeStats?.disputes_won || 0,
        disputes_lost: disputeStats?.disputes_lost || 0,
        active_days_last_30: activityStats?.active_days || 0,
        orders_last_30_days: orderStats?.orders_last_30_days || 0,
        longest_inactive_streak: activityStats?.longest_inactive || 0,
        volume_percentile: volumePercentile?.percentile || 0,
        user_number: userNumber?.row_num,
    };
}
/**
 * Fetch merchant stats
 */
async function getMerchantStats(merchantId) {
    const merchant = await queryOne('SELECT * FROM merchants WHERE id = $1', [merchantId]);
    if (!merchant)
        return null;
    // Get order stats
    const orderStats = await queryOne(`SELECT
      COUNT(*)::int as total_orders,
      COUNT(*) FILTER (WHERE status = 'completed')::int as completed_orders,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int as cancelled_orders,
      COUNT(*) FILTER (WHERE status = 'disputed')::int as disputed_orders,
      COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60)
        FILTER (WHERE status = 'completed'), 30)::int as avg_completion_mins,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int as orders_last_30_days,
      COALESCE(SUM(fiat_amount) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'), 0)::numeric as volume_last_30_days,
      COALESCE(SUM(fiat_amount) FILTER (WHERE created_at > NOW() - INTERVAL '7 days'), 0)::numeric as volume_last_7_days
    FROM orders WHERE merchant_id = $1`, [merchantId]);
    // Get review stats
    const reviewStats = await queryOne(`SELECT
      COUNT(*)::int as review_count,
      COALESCE(AVG(rating), 0)::numeric as average_rating,
      COUNT(*) FILTER (WHERE rating = 5)::int as five_star_count,
      COUNT(*) FILTER (WHERE rating = 1)::int as one_star_count
    FROM reviews WHERE reviewee_id = $1 AND reviewee_type = 'merchant'`, [merchantId]);
    // Get recent reviews for trend
    const recentReviews = await query(`SELECT rating, created_at FROM reviews
     WHERE reviewee_id = $1 AND reviewee_type = 'merchant'
     ORDER BY created_at DESC LIMIT 10`, [merchantId]);
    // Get dispute stats
    const disputeStats = await queryOne(`SELECT
      COUNT(*)::int as disputes_raised,
      COUNT(*) FILTER (WHERE resolved_in_favor_of = 'merchant')::int as disputes_won,
      COUNT(*) FILTER (WHERE resolved_in_favor_of = 'user')::int as disputes_lost
    FROM disputes d
    JOIN orders o ON d.order_id = o.id
    WHERE o.merchant_id = $1`, [merchantId]);
    // Get activity stats
    const activityStats = await queryOne(`WITH daily_activity AS (
      SELECT DATE(created_at) as activity_date
      FROM orders WHERE merchant_id = $1 AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
    )
    SELECT
      COUNT(*)::int as active_days,
      COALESCE(MAX(gap_days), 0)::int as longest_inactive
    FROM (
      SELECT
        activity_date,
        EXTRACT(DAY FROM activity_date - LAG(activity_date) OVER (ORDER BY activity_date))::int as gap_days
      FROM daily_activity
    ) gaps`, [merchantId]);
    // Get volume percentile among merchants
    const volumePercentile = await queryOne(`SELECT PERCENT_RANK() OVER (ORDER BY total_volume) * 100 as percentile
     FROM merchants WHERE id = $1`, [merchantId]);
    return {
        entity_id: merchantId,
        entity_type: 'merchant',
        created_at: merchant.created_at,
        kyc_level: merchant.verification_level || 0,
        verification_status: merchant.status || 'pending',
        total_orders: orderStats?.total_orders || 0,
        completed_orders: orderStats?.completed_orders || 0,
        cancelled_orders: orderStats?.cancelled_orders || 0,
        disputed_orders: orderStats?.disputed_orders || 0,
        avg_completion_time_mins: orderStats?.avg_completion_mins || 30,
        total_volume_usd: Number(merchant.total_volume) || 0,
        last_30_days_volume: Number(orderStats?.volume_last_30_days) || 0,
        last_7_days_volume: Number(orderStats?.volume_last_7_days) || 0,
        review_count: reviewStats?.review_count || merchant.rating_count || 0,
        average_rating: Number(reviewStats?.average_rating) || merchant.rating || 0,
        five_star_count: reviewStats?.five_star_count || 0,
        one_star_count: reviewStats?.one_star_count || 0,
        recent_reviews: recentReviews || [],
        disputes_raised: disputeStats?.disputes_raised || 0,
        disputes_won: disputeStats?.disputes_won || 0,
        disputes_lost: disputeStats?.disputes_lost || 0,
        active_days_last_30: activityStats?.active_days || 0,
        orders_last_30_days: orderStats?.orders_last_30_days || 0,
        longest_inactive_streak: activityStats?.longest_inactive || 0,
        volume_percentile: volumePercentile?.percentile || 0,
    };
}
// ============================================================================
// SCORE OPERATIONS
// ============================================================================
/**
 * Get current reputation score
 */
export async function getReputationScore(entityId, entityType) {
    const score = await queryOne(`SELECT * FROM reputation_scores WHERE entity_id = $1 AND entity_type = $2`, [entityId, entityType]);
    if (!score)
        return null;
    return {
        ...score,
        badges: score.badges,
    };
}
/**
 * Calculate and update reputation score
 */
export async function updateReputationScore(entityId, entityType) {
    const stats = await getEntityStats(entityId, entityType);
    if (!stats)
        return null;
    const score = calculateReputationScore(stats);
    // Upsert score
    await query(`INSERT INTO reputation_scores (
      entity_id, entity_type, total_score, review_score, execution_score,
      volume_score, consistency_score, trust_score, tier, badges, calculated_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
    ON CONFLICT (entity_id, entity_type)
    DO UPDATE SET
      total_score = $3,
      review_score = $4,
      execution_score = $5,
      volume_score = $6,
      consistency_score = $7,
      trust_score = $8,
      tier = $9,
      badges = $10,
      calculated_at = NOW(),
      updated_at = NOW()`, [
        entityId,
        entityType,
        score.total_score,
        score.review_score,
        score.execution_score,
        score.volume_score,
        score.consistency_score,
        score.trust_score,
        score.tier,
        score.badges,
    ]);
    return score;
}
/**
 * Get reputation with full breakdown
 */
export async function getReputationWithBreakdown(entityId, entityType) {
    const stats = await getEntityStats(entityId, entityType);
    if (!stats)
        return null;
    const score = calculateReputationScore(stats);
    const breakdown = calculateReputationBreakdown(stats);
    return { score, breakdown };
}
// ============================================================================
// HISTORY OPERATIONS
// ============================================================================
/**
 * Record reputation snapshot
 */
export async function recordReputationSnapshot(entityId, entityType) {
    const score = await getReputationScore(entityId, entityType);
    if (!score)
        return;
    await query(`INSERT INTO reputation_history (
      entity_id, entity_type, total_score, review_score, execution_score,
      volume_score, consistency_score, trust_score, tier
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
        entityId,
        entityType,
        score.total_score,
        score.review_score,
        score.execution_score,
        score.volume_score,
        score.consistency_score,
        score.trust_score,
        score.tier,
    ]);
}
/**
 * Get reputation history
 */
export async function getReputationHistory(entityId, entityType, days = 30) {
    return query(`SELECT * FROM reputation_history
     WHERE entity_id = $1 AND entity_type = $2
       AND recorded_at > NOW() - INTERVAL '1 day' * $3
     ORDER BY recorded_at ASC`, [entityId, entityType, days]);
}
// ============================================================================
// EVENT OPERATIONS
// ============================================================================
/**
 * Record reputation event
 */
export async function recordReputationEvent(entityId, entityType, eventType, reason, metadata) {
    const scoreChange = calculateScoreChangeForEvent(eventType, metadata);
    await query(`INSERT INTO reputation_events (entity_id, entity_type, event_type, score_change, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`, [entityId, entityType, eventType, scoreChange, reason, JSON.stringify(metadata || {})]);
    // Trigger reputation recalculation
    await updateReputationScore(entityId, entityType);
}
/**
 * Get recent reputation events
 */
export async function getReputationEvents(entityId, entityType, limit = 20) {
    return query(`SELECT * FROM reputation_events
     WHERE entity_id = $1 AND entity_type = $2
     ORDER BY created_at DESC
     LIMIT $3`, [entityId, entityType, limit]);
}
// ============================================================================
// LEADERBOARD OPERATIONS
// ============================================================================
/**
 * Get reputation leaderboard
 */
export async function getReputationLeaderboard(entityType, limit = 100) {
    const tableName = entityType === 'user' ? 'users' : 'merchants';
    const nameField = entityType === 'user' ? 'name' : 'display_name';
    return query(`SELECT
      rs.*,
      ROW_NUMBER() OVER (ORDER BY rs.total_score DESC) as rank,
      e.${nameField} as name
     FROM reputation_scores rs
     JOIN ${tableName} e ON rs.entity_id = e.id
     WHERE rs.entity_type = $1
     ORDER BY rs.total_score DESC
     LIMIT $2`, [entityType, limit]);
}
/**
 * Get entity rank
 */
export async function getEntityRank(entityId, entityType) {
    const result = await queryOne(`SELECT rank FROM (
      SELECT entity_id, ROW_NUMBER() OVER (ORDER BY total_score DESC) as rank
      FROM reputation_scores
      WHERE entity_type = $1
    ) ranked
    WHERE entity_id = $2`, [entityType, entityId]);
    return result?.rank || null;
}
// ============================================================================
// BATCH OPERATIONS
// ============================================================================
/**
 * Recalculate all reputation scores
 */
export async function recalculateAllScores() {
    // Get all users
    const users = await query('SELECT id FROM users');
    let userCount = 0;
    for (const user of users) {
        await updateReputationScore(user.id, 'user');
        userCount++;
    }
    // Get all merchants
    const merchants = await query('SELECT id FROM merchants');
    let merchantCount = 0;
    for (const merchant of merchants) {
        await updateReputationScore(merchant.id, 'merchant');
        merchantCount++;
    }
    return { users: userCount, merchants: merchantCount };
}
/**
 * Record daily snapshots for all entities
 */
export async function recordDailySnapshots() {
    const entities = await query('SELECT entity_id, entity_type FROM reputation_scores');
    for (const entity of entities) {
        await recordReputationSnapshot(entity.entity_id, entity.entity_type);
    }
}
// ============================================================================
// EXPORT
// ============================================================================
export default {
    initializeReputationTables,
    getEntityStats,
    getReputationScore,
    updateReputationScore,
    getReputationWithBreakdown,
    recordReputationSnapshot,
    getReputationHistory,
    recordReputationEvent,
    getReputationEvents,
    getReputationLeaderboard,
    getEntityRank,
    recalculateAllScores,
    recordDailySnapshots,
};
