import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

// Disable Next.js full-route caching — stats reflect live DB state.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Combine V1 and V2 stats
    const [totalTrades, totalVolume, activeMerchants, avgTime] = await Promise.all([
      // Total trades from both V1 and V2
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM trades) +
          (SELECT COUNT(*) FROM v2_trades) as count
      `),
      // Total volume from released trades (V1 + V2)
      pool.query(`
        SELECT
          COALESCE((SELECT SUM(amount::BIGINT) FROM trades WHERE state = 'Released'), 0) +
          COALESCE((SELECT SUM(amount::BIGINT) FROM v2_trades WHERE status = 'released'), 0) as total
      `),
      // Active merchants (unique across V1 and V2)
      pool.query(`
        SELECT COUNT(DISTINCT merchant) as count FROM (
          SELECT merchant FROM trades
          UNION
          SELECT creator_pubkey as merchant FROM v2_trades
        ) combined
      `),
      // Average settlement time = create → release (full lifecycle ONLY).
      // Previously this query also included `locked` trades using
      // `COALESCE(released_at, locked_at)` as a stand-in end-time. That makes
      // the metric mean "average time-to-lock-or-release" rather than
      // "average settlement" — understating settlement when many trades are
      // in-flight. We now only average over fully-settled trades. If no trades
      // have settled yet, NULL → UI shows "—" (handled by `|| '0'` below),
      // which is more honest than a misleading number.
      pool.query(`
        SELECT AVG(seconds) as avg_seconds FROM (
          SELECT EXTRACT(EPOCH FROM (released_at - created_at)) as seconds
          FROM trades
          WHERE state = 'Released'
            AND created_at IS NOT NULL
            AND released_at IS NOT NULL
          UNION ALL
          SELECT EXTRACT(EPOCH FROM (released_at - created_at)) as seconds
          FROM v2_trades
          WHERE status = 'released'
            AND created_at IS NOT NULL
            AND released_at IS NOT NULL
        ) combined
      `),
    ]);

    return NextResponse.json({
      total_trades: parseInt(totalTrades.rows[0].count) || 0,
      total_volume: totalVolume.rows[0].total || '0',
      active_merchants: parseInt(activeMerchants.rows[0].count) || 0,
      avg_completion_time: parseFloat(avgTime.rows[0].avg_seconds || '0'),
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
