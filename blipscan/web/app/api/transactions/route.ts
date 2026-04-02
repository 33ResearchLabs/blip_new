import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const trade_pda = searchParams.get('trade_pda');
    const instruction = searchParams.get('instruction');
    const version = searchParams.get('version');
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = `SELECT * FROM transactions WHERE 1=1`;
    const params: any[] = [];
    let paramIdx = 1;

    if (trade_pda) {
      query += ` AND trade_pda = $${paramIdx++}`;
      params.push(trade_pda);
    }
    if (instruction) {
      query += ` AND instruction_type = $${paramIdx++}`;
      params.push(instruction);
    }
    if (version) {
      query += ` AND version = $${paramIdx++}`;
      params.push(version);
    }

    query += ` ORDER BY block_time DESC LIMIT $${paramIdx}`;
    params.push(limit);

    const result = await pool.query(query, params);

    return NextResponse.json({
      transactions: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}
