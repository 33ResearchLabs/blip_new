import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { pubkey: string } }
) {
  try {
    const result = await pool.query(
      `SELECT
        m.wallet_address as merchant_pubkey,
        m.total_trades,
        m.total_volume,
        (
          COALESCE((SELECT COUNT(*) FROM trades WHERE merchant = $1 AND LOWER(state) = 'released'), 0) +
          COALESCE((SELECT COUNT(*) FROM v2_trades WHERE (creator_pubkey = $1 OR counterparty_pubkey = $1) AND status = 'released'), 0) +
          COALESCE((SELECT COUNT(*) FROM orders WHERE merchant_id = m.id AND status = 'completed'), 0)
        )::int as completed_trades,
        (
          COALESCE((SELECT COUNT(*) FROM trades WHERE merchant = $1 AND LOWER(state) = 'refunded'), 0) +
          COALESCE((SELECT COUNT(*) FROM v2_trades WHERE (creator_pubkey = $1 OR counterparty_pubkey = $1) AND status = 'refunded'), 0) +
          COALESCE((SELECT COUNT(*) FROM orders WHERE merchant_id = m.id AND status = 'cancelled'), 0)
        )::int as cancelled_trades,
        COALESCE(m.avg_response_time_mins * 60, 0)::int as avg_completion_time_seconds,
        m.updated_at as last_trade_at
      FROM merchants m WHERE m.wallet_address = $1`,
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
