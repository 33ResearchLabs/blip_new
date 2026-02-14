import { query, queryOne } from '../index';

export interface Rating {
  id: string;
  order_id: string;
  rater_type: 'merchant' | 'user';
  rater_id: string;
  rated_type: 'merchant' | 'user';
  rated_id: string;
  rating: number;
  review_text?: string;
  created_at: string;
}

export interface TopRatedSeller {
  id: string;
  username: string;
  display_name: string;
  rating: number;
  rating_count: number;
  total_trades: number;
  wallet_address?: string;
  created_at: string;
  rank: number;
}

export interface TopRatedUser {
  id: string;
  username: string;
  rating: number;
  rating_count: number;
  total_trades: number;
  wallet_address?: string;
  created_at: string;
  rank: number;
}

export interface OrderRatingStatus {
  order_id: string;
  merchant_rated: boolean;
  user_rated: boolean;
  merchant_rating?: number;
  user_rating?: number;
  merchant_rated_at?: string;
  user_rated_at?: string;
}

// Create a new rating
export async function createRating(data: {
  order_id: string;
  rater_type: 'merchant' | 'user';
  rater_id: string;
  rated_type: 'merchant' | 'user';
  rated_id: string;
  rating: number;
  review_text?: string;
}): Promise<Rating> {
  const result = await queryOne<Rating>(
    `INSERT INTO ratings (order_id, rater_type, rater_id, rated_type, rated_id, rating, review_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.order_id,
      data.rater_type,
      data.rater_id,
      data.rated_type,
      data.rated_id,
      data.rating,
      data.review_text || null,
    ]
  );
  return result!;
}

// Get rating status for an order
export async function getOrderRatingStatus(orderId: string): Promise<OrderRatingStatus | null> {
  return queryOne<OrderRatingStatus>(
    `SELECT
      id as order_id,
      merchant_rated_at IS NOT NULL as merchant_rated,
      user_rated_at IS NOT NULL as user_rated,
      merchant_rating,
      user_rating,
      merchant_rated_at,
      user_rated_at
    FROM orders
    WHERE id = $1`,
    [orderId]
  );
}

// Check if a specific party has rated an order
export async function hasRated(
  orderId: string,
  raterType: 'merchant' | 'user',
  raterId: string
): Promise<boolean> {
  const result = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS(
      SELECT 1 FROM ratings
      WHERE order_id = $1 AND rater_type = $2 AND rater_id = $3
    ) as exists`,
    [orderId, raterType, raterId]
  );
  return result?.exists || false;
}

// Get all ratings for a user/merchant
export async function getRatingsForEntity(
  entityType: 'merchant' | 'user',
  entityId: string,
  limit = 50,
  offset = 0
): Promise<Rating[]> {
  return query<Rating>(
    `SELECT * FROM ratings
     WHERE rated_type = $1 AND rated_id = $2
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [entityType, entityId, limit, offset]
  );
}

// Get ratings given by a user/merchant
export async function getRatingsByEntity(
  entityType: 'merchant' | 'user',
  entityId: string,
  limit = 50,
  offset = 0
): Promise<Rating[]> {
  return query<Rating>(
    `SELECT * FROM ratings
     WHERE rater_type = $1 AND rater_id = $2
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [entityType, entityId, limit, offset]
  );
}

// Get top rated sellers
export async function getTopRatedSellers(limit = 10): Promise<TopRatedSeller[]> {
  return query<TopRatedSeller>(
    `SELECT * FROM v_top_rated_sellers LIMIT $1`,
    [limit]
  );
}

// Get top rated users
export async function getTopRatedUsers(limit = 10): Promise<TopRatedUser[]> {
  return query<TopRatedUser>(
    `SELECT * FROM v_top_rated_users LIMIT $1`,
    [limit]
  );
}

// Get user/merchant aggregate rating
export async function getAggregateRating(
  entityType: 'merchant' | 'user',
  entityId: string
): Promise<{ rating: number; rating_count: number } | null> {
  if (entityType === 'merchant') {
    return queryOne<{ rating: number; rating_count: number }>(
      `SELECT rating, rating_count FROM merchants WHERE id = $1`,
      [entityId]
    );
  } else {
    return queryOne<{ rating: number; rating_count: number }>(
      `SELECT rating, rating_count FROM users WHERE id = $1`,
      [entityId]
    );
  }
}

// Get pending ratings for a user/merchant (completed orders they haven't rated yet)
export async function getPendingRatingsForMerchant(merchantId: string): Promise<{
  order_id: string;
  user_id: string;
  user_name: string;
  completed_at: string;
}[]> {
  return query<{
    order_id: string;
    user_id: string;
    user_name: string;
    completed_at: string;
  }>(
    `SELECT
      o.id as order_id,
      o.user_id,
      u.username as user_name,
      o.completed_at
    FROM orders o
    JOIN users u ON o.user_id = u.id
    WHERE o.merchant_id = $1
      AND o.status = 'completed'
      AND o.merchant_rated_at IS NULL
      AND o.completed_at IS NOT NULL
      AND o.completed_at > NOW() - INTERVAL '30 days'  -- Only last 30 days
    ORDER BY o.completed_at DESC`,
    [merchantId]
  );
}

// Get pending ratings for a user (completed orders they haven't rated yet)
export async function getPendingRatingsForUser(userId: string): Promise<{
  order_id: string;
  merchant_id: string;
  merchant_name: string;
  completed_at: string;
}[]> {
  return query<{
    order_id: string;
    merchant_id: string;
    merchant_name: string;
    completed_at: string;
  }>(
    `SELECT
      o.id as order_id,
      o.merchant_id,
      m.display_name as merchant_name,
      o.completed_at
    FROM orders o
    JOIN merchants m ON o.merchant_id = m.id
    WHERE o.user_id = $1
      AND o.status = 'completed'
      AND o.user_rated_at IS NULL
      AND o.completed_at IS NOT NULL
      AND o.completed_at > NOW() - INTERVAL '30 days'  -- Only last 30 days
    ORDER BY o.completed_at DESC`,
    [userId]
  );
}
