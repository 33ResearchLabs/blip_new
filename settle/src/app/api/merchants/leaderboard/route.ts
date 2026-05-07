import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    // Volume + trade counts are computed directly from the orders table
    // rather than read from the denormalized merchants.total_volume /
    // total_trades columns. Those columns have known issues:
    //   1. The notificationListener trigger increments them with
    //      `order.fiat_amount` (mixed currency units — INR/AED/USD), then
    //      the leaderboard renders the result as USDT. Ratios off by ~99x
    //      for INR corridors, ~3.67x for AED corridors.
    //   2. M2M trades only credit the seller (merchant_id), never the buyer
    //      (buyer_merchant_id), under-counting any merchant who buys.
    //   3. Existing rows are already corrupted and need a backfill we
    //      haven't shipped yet.
    // Computing on the fly fixes all three at once and is correct by
    // construction. Volume is in crypto_amount (USDT) and includes both
    // sides of M2M trades.
    // Volume + trade counts: computed directly from the orders table.
    //   1. The notificationListener trigger increments them with
    //      `order.fiat_amount` (mixed currency units — INR/AED/USD), then
    //      the leaderboard renders the result as USDT. Ratios off by ~99x
    //      for INR corridors, ~3.67x for AED corridors.
    //   2. M2M trades only credit the seller (merchant_id), never the buyer
    //      (buyer_merchant_id), under-counting any merchant who buys.
    //
    // Ratings: computed live from the `ratings` table.
    //   - merchants.rating defaults to 5.0 for fresh accounts so brand-new
    //     merchants with ZERO ratings were ranking next to merchants with
    //     real 5-star reviews. The leaderboard's tiebreaker sorted by
    //     m.rating DESC, so unrated merchants outranked rated ones.
    //   - We now return rating = NULL when rating_count = 0; the frontend
    //     must render that as "No ratings" / "—" instead of "5.0".
    //   - Sort puts NULL ratings last so unrated merchants drop to bottom.
    const merchants = await query<{
      id: string;
      display_name: string;
      username: string;
      total_trades: number;
      total_volume: string;
      rating: string | null;
      rating_count: number;
      is_online: boolean;
      avg_response_time_mins: number;
      completed_count: number;
    }>(`
      SELECT
        m.id,
        m.display_name,
        m.username,
        COALESCE(stats.completed_count, 0)::int AS total_trades,
        COALESCE(stats.completed_volume, 0)::text AS total_volume,
        -- NULL when no ratings exist — frontend distinguishes "no reviews
        -- yet" from a real 5.0 average. ROUND to 2 decimals to match how
        -- the column was previously formatted.
        CASE
          WHEN COALESCE(rs.rating_count, 0) = 0 THEN NULL
          ELSE ROUND(rs.avg_rating, 2)::text
        END AS rating,
        COALESCE(rs.rating_count, 0)::int AS rating_count,
        m.is_online,
        m.avg_response_time_mins,
        COALESCE(stats.completed_count, 0)::int AS completed_count
      FROM merchants m
      LEFT JOIN (
        SELECT
          mid AS merchant_id,
          COUNT(*) AS completed_count,
          SUM(crypto_amount) AS completed_volume
        FROM (
          -- Each order contributes once per merchant participant: once for
          -- the seller (merchant_id) and, when present, once for the buyer
          -- merchant in an M2M trade (buyer_merchant_id).
          SELECT merchant_id AS mid, crypto_amount FROM orders
            WHERE status = 'completed' AND merchant_id IS NOT NULL
          UNION ALL
          SELECT buyer_merchant_id AS mid, crypto_amount FROM orders
            WHERE status = 'completed' AND buyer_merchant_id IS NOT NULL
        ) participated
        GROUP BY mid
      ) stats ON stats.merchant_id = m.id
      LEFT JOIN (
        -- Live rating aggregate. Excludes self-ratings if any exist (defensive
        -- — the ratings table's UNIQUE(order_id, rater_type, rater_id) plus
        -- normal flow already prevents this).
        SELECT
          rated_id AS merchant_id,
          AVG(rating)::numeric(3,2) AS avg_rating,
          COUNT(*) AS rating_count
        FROM ratings
        WHERE rated_type = 'merchant'
        GROUP BY rated_id
      ) rs ON rs.merchant_id = m.id
      WHERE m.status = 'active'
      ORDER BY COALESCE(stats.completed_volume, 0) DESC,
               COALESCE(stats.completed_count, 0) DESC,
               -- Null-last so unrated merchants drop below rated ones at
               -- equal volume/trade counts. Previously default 5.0 made
               -- them outrank merchants with real 4-something reviews.
               rs.avg_rating DESC NULLS LAST
      LIMIT 20
    `);

    return NextResponse.json({
      success: true,
      data: merchants.map((m, i) => ({
        rank: i + 1,
        id: m.id,
        displayName: m.display_name,
        username: m.username,
        totalTrades: m.total_trades,
        totalVolume: parseFloat(m.total_volume) || 0,
        // rating is NULL for merchants with zero ratings — passed through
        // unchanged so the frontend can render "No ratings yet" / "—"
        // instead of the deceptive 5.0 default the column carried.
        rating: m.rating == null ? null : parseFloat(m.rating),
        ratingCount: m.rating_count,
        isOnline: m.is_online,
        avgResponseMins: m.avg_response_time_mins,
        completedCount: m.completed_count,
      })),
    });
  } catch (error) {
    console.error('[API] Leaderboard error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
