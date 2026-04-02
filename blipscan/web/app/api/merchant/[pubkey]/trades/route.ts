import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { pubkey: string } }
) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20');

    const result = await pool.query(
      `SELECT * FROM (
        SELECT
          trade_pda as escrow_address,
          trade_id as deal_id,
          merchant as merchant_pubkey,
          "user" as buyer_pubkey,
          amount,
          state as status,
          created_at,
          'v1' as protocol_version
        FROM trades WHERE merchant = $1
        UNION ALL
        SELECT
          trade_pda as escrow_address,
          trade_id::text as deal_id,
          creator_pubkey as merchant_pubkey,
          counterparty_pubkey as buyer_pubkey,
          amount,
          status,
          created_at,
          'v2.2' as protocol_version
        FROM v2_trades WHERE creator_pubkey = $1
      ) combined ORDER BY created_at DESC LIMIT $2`,
      [params.pubkey, limit]
    );

    return NextResponse.json({
      trades: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error('Error fetching merchant trades:', error);
    return NextResponse.json(
      { error: 'Failed to fetch merchant trades' },
      { status: 500 }
    );
  }
}
