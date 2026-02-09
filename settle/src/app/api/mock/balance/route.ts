import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { MOCK_MODE } from '@/lib/config/mockMode';

/**
 * GET /api/mock/balance?userId=xxx&type=user|merchant
 * Returns the DB balance for a user or merchant
 */
export async function GET(request: NextRequest) {
  if (!MOCK_MODE) {
    return NextResponse.json({ error: 'Mock mode is disabled' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const type = searchParams.get('type') || 'user';

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const table = type === 'merchant' ? 'merchants' : 'users';
    const row = await queryOne<{ balance: number }>(
      `SELECT COALESCE(balance, 0) as balance FROM ${table} WHERE id = $1`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      balance: row ? parseFloat(String(row.balance)) : 0,
    });
  } catch (error) {
    console.error('[Mock Balance] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 });
  }
}

/**
 * POST /api/mock/balance
 * { userId, type, action: 'deduct' | 'credit', amount }
 * Updates the DB balance for mock escrow operations
 */
export async function POST(request: NextRequest) {
  if (!MOCK_MODE) {
    return NextResponse.json({ error: 'Mock mode is disabled' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { userId, type = 'user', action, amount } = body;

    if (!userId || !action || !amount) {
      return NextResponse.json({ error: 'userId, action, and amount are required' }, { status: 400 });
    }

    if (amount <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    }

    const table = type === 'merchant' ? 'merchants' : 'users';

    if (action === 'deduct') {
      // Deduct with balance check to prevent negative
      const result = await query(
        `UPDATE ${table} SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance`,
        [amount, userId]
      );

      if (!result || result.length === 0) {
        return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        balance: parseFloat(String((result[0] as { balance: number }).balance)),
      });
    }

    if (action === 'credit') {
      const result = await query(
        `UPDATE ${table} SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
        [amount, userId]
      );

      if (!result || result.length === 0) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        balance: parseFloat(String((result[0] as { balance: number }).balance)),
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use "deduct" or "credit"' }, { status: 400 });
  } catch (error) {
    console.error('[Mock Balance] POST error:', error);
    return NextResponse.json({ error: 'Failed to update balance' }, { status: 500 });
  }
}
