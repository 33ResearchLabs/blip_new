import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
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
        m.total_trades,
        m.total_volume,
        m.rating,
        m.rating_count,
        m.is_online,
        m.avg_response_time_mins,
        COALESCE((SELECT COUNT(*) FROM orders o WHERE o.merchant_id = m.id AND o.status = 'completed'), 0)::int as completed_count
      FROM merchants m
      WHERE m.status = 'active'
      ORDER BY m.total_volume DESC, m.total_trades DESC, m.rating DESC
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
