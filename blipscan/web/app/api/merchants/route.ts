import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '100');

    const result = await pool.query(
      `SELECT
        wallet_address as merchant_pubkey,
        display_name,
        business_name,
        total_trades,
        total_volume,
        rating,
        rating_count,
        is_online,
        last_seen_at,
        created_at
      FROM merchants
      ORDER BY total_trades DESC
      LIMIT $1`,
      [limit]
    );

    return NextResponse.json({
      merchants: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error('Error fetching merchants:', error);
    return NextResponse.json(
      { error: 'Failed to fetch merchants' },
      { status: 500 }
    );
  }
}
