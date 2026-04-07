import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

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
      // Average completion time (V1 + V2 with locked_at)
      pool.query(`
        SELECT AVG(avg_seconds) as avg_seconds FROM (
          SELECT EXTRACT(EPOCH FROM (locked_at - created_at)) as avg_seconds
          FROM trades
          WHERE state IN ('Released', 'Locked') AND locked_at IS NOT NULL AND created_at IS NOT NULL
          UNION ALL
          SELECT EXTRACT(EPOCH FROM (locked_at - created_at)) as avg_seconds
          FROM v2_trades
          WHERE status IN ('released', 'locked') AND locked_at IS NOT NULL AND created_at IS NOT NULL
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
