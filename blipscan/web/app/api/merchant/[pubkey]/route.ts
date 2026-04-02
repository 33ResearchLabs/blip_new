import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { pubkey: string } }
) {
  try {
    const result = await pool.query(
      `SELECT
        pubkey as merchant_pubkey,
        total_trades,
        total_volume,
        completed_trades,
        disputed_trades as cancelled_trades,
        avg_close_time_seconds as avg_completion_time_seconds,
        CASE
          WHEN total_trades > 0
          THEN (completed_trades::DECIMAL / total_trades * 100)
          ELSE 0
        END as completion_rate,
        updated_at as last_trade_at
      FROM merchants WHERE pubkey = $1`,
      [params.pubkey]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching merchant stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch merchant stats' },
      { status: 500 }
    );
  }
}
