import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const operation = searchParams.get('operation'); // 'CreateLane', 'FundLane', 'WithdrawLane'
    const laneId = searchParams.get('laneId');
    const merchantWallet = searchParams.get('merchantWallet');
    const limit = parseInt(searchParams.get('limit') || '20');

    let query = 'SELECT * FROM lane_operations WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (operation) {
      query += ` AND operation = $${paramIndex}`;
      params.push(operation);
      paramIndex++;
    }

    if (laneId) {
      query += ` AND "laneId" = $${paramIndex}`;
      params.push(parseInt(laneId));
      paramIndex++;
    }

    if (merchantWallet) {
      query += ` AND "merchantWallet" = $${paramIndex}`;
      params.push(merchantWallet);
      paramIndex++;
    }

    query += ` ORDER BY "createdAt" DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);

    return NextResponse.json({
      operations: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error('Error fetching lane operations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lane operations' },
      { status: 500 }
    );
  }
}
