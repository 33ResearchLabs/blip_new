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
    const merchants = await query<{
      id: string;
      display_name: string;
      username: string;
      total_trades: number;
      total_volume: string;
      rating: string;
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
        m.rating,
        m.rating_count,
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
      WHERE m.status = 'active'
      ORDER BY COALESCE(stats.completed_volume, 0) DESC,
               COALESCE(stats.completed_count, 0) DESC,
               m.rating DESC
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
        rating: parseFloat(m.rating) || 5.0,
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
