import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '20');
    const version = searchParams.get('version'); // 'v1', 'v2', or null for both

    // Combine V1 (blockchain_trades) and V2 (v2_trades) trades
    let query = '';
    const params: any[] = [];

    if (version === 'v1') {
      // V1 trades only
      query = `SELECT
        trade_pda as escrow_address,
        trade_id as deal_id,
        merchant as merchant_pubkey,
        "user" as buyer_pubkey,
        arbiter,
        treasury,
        mint as mint_address,
        amount::text,
        0 as fee_bps,
        state as status,
        created_at,
        locked_at,
        created_slot,
        locked_slot,
        released_slot,
        'v1' as protocol_version
      FROM trades WHERE protocol_version = 'v1'`;
      if (status) {
        query += ' AND state = $1';
        params.push(status);
      }
    } else if (version === 'v2') {
      // V2 trades only
      query = `SELECT
        trade_pda as escrow_address,
        trade_id::text as deal_id,
        creator_pubkey as merchant_pubkey,
        counterparty_pubkey as buyer_pubkey,
        NULL as arbiter,
        NULL as treasury,
        mint_address,
        amount::text,
        0 as fee_bps,
        status,
        created_at,
        locked_at,
        created_slot,
        locked_slot,
        released_slot,
        'v2.2' as protocol_version,
        lane_id
      FROM v2_trades`;
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }
    } else {
      // Both V1 and V2 trades combined
      query = `
        SELECT * FROM (
          SELECT
            trade_pda as escrow_address,
            trade_id as deal_id,
            merchant as merchant_pubkey,
            "user" as buyer_pubkey,
            arbiter,
            treasury,
            mint as mint_address,
            amount::text,
            0 as fee_bps,
            state as status,
            created_at,
            locked_at,
            created_slot::text,
            locked_slot::text,
            released_slot::text,
            'v1' as protocol_version,
            NULL::int as lane_id
          FROM trades WHERE protocol_version = 'v1'
          UNION ALL
          SELECT
            trade_pda as escrow_address,
            trade_id::text as deal_id,
            creator_pubkey as merchant_pubkey,
            counterparty_pubkey as buyer_pubkey,
            NULL as arbiter,
            NULL as treasury,
            mint_address,
            amount::text,
            0 as fee_bps,
            status,
            created_at,
            locked_at,
            created_slot::text,
            locked_slot::text,
            released_slot::text,
            'v2.2' as protocol_version,
            lane_id
          FROM v2_trades
        ) combined`;
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await pool.query(query, params);

    return NextResponse.json({
      trades: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error('Error fetching trades:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trades' },
      { status: 500 }
    );
  }
}
