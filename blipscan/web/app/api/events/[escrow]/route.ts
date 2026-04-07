import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { escrow: string } }
) {
  try {
    const result = await pool.query(
      'SELECT * FROM trade_events WHERE trade_pda = $1 ORDER BY slot DESC',
      [params.escrow]
    );

    return NextResponse.json({
      events: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch events' },
      { status: 500 }
    );
  }
}
