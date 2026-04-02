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
      `SELECT
        trade_pda as escrow_address,
        trade_id as deal_id,
        merchant as merchant_pubkey,
        "user" as buyer_pubkey,
        arbiter,
        treasury,
        mint as mint_address,
        amount,
        fee_amount as fee_bps,
        state as status,
        created_at,
        locked_at,
        created_slot,
        locked_slot,
        released_slot
      FROM trades WHERE merchant = $1 ORDER BY created_at DESC LIMIT $2`,
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
