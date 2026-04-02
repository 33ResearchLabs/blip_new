import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { escrow: string } }
) {
  try {
    const escrowAddress = params.escrow;

    // Get order events linked to this escrow via escrow_trade_pda or escrow_pda
    const result = await pool.query(
      `SELECT
        oe.event_type,
        oe.old_status,
        oe.new_status,
        oe.created_at,
        oe.actor_type
      FROM order_events oe
      JOIN orders o ON o.id = oe.order_id
      WHERE o.escrow_trade_pda = $1 OR o.escrow_pda = $1 OR o.escrow_address = $1
      ORDER BY oe.created_at ASC`,
      [escrowAddress]
    );

    return NextResponse.json({
      events: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error('Error fetching lifecycle events:', error);
    return NextResponse.json({ events: [], total: 0 });
  }
}
