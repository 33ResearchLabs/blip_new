import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { escrow: string } }
) {
  try {
    const escrowAddress = params.escrow;

    // Try V1 trades first
    let result = await pool.query(
      `SELECT
        trade_pda as escrow_address,
        trade_id as deal_id,
        merchant as merchant_pubkey,
        "user" as buyer_pubkey,
        arbiter as arbiter_pubkey,
        treasury as treasury_pubkey,
        mint as mint_address,
        amount::text,
        0 as fee_bps,
        state as status,
        created_at,
        locked_at,
        released_at,
        refunded_at,
        created_slot::text,
        locked_slot::text,
        released_slot::text,
        'v1' as protocol_version,
        NULL as lane_id,
        created_signature,
        locked_signature,
        released_signature,
        refunded_signature
      FROM trades WHERE trade_pda = $1`,
      [escrowAddress]
    );

    // If not found in V1, try V2 v2_trades
    if (result.rows.length === 0) {
      result = await pool.query(
        `SELECT
          trade_pda as escrow_address,
          trade_id::text as deal_id,
          creator_pubkey as merchant_pubkey,
          counterparty_pubkey as buyer_pubkey,
          NULL as arbiter_pubkey,
          NULL as treasury_pubkey,
          mint_address,
          amount::text,
          0 as fee_bps,
          status,
          created_at,
          locked_at,
          released_at,
          created_slot::text,
          locked_slot::text,
          released_slot::text,
          'v2.2' as protocol_version,
          lane_id,
          created_signature,
          locked_signature,
          released_signature,
          refunded_signature
        FROM v2_trades WHERE trade_pda = $1`,
        [escrowAddress]
      );
    }

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching trade:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trade' },
      { status: 500 }
    );
  }
}
