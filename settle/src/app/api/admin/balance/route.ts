import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

// GET /api/admin/balance - Get platform fee balance and breakdown
export async function GET() {
  try {
    const balance = await queryOne<{ balance: string; total_fees_collected: string }>(
      `SELECT balance::text, total_fees_collected::text FROM platform_balance WHERE key = 'main'`
    );

    // Fee breakdown by tier
    const tierBreakdown = await query<{ spread_preference: string; count: string; total_fees: string }>(
      `SELECT
        spread_preference,
        COUNT(*)::text,
        SUM(fee_amount)::numeric(10,4)::text as total_fees
       FROM platform_fee_transactions
       GROUP BY spread_preference
       ORDER BY total_fees DESC`
    );

    // Recent fee transactions
    const recentFees = await query<{
      order_id: string; fee_amount: string; fee_percentage: string;
      spread_preference: string; created_at: string;
    }>(
      `SELECT order_id, fee_amount::text, fee_percentage::text,
              spread_preference, created_at::text
       FROM platform_fee_transactions
       ORDER BY created_at DESC
       LIMIT 20`
    );

    return NextResponse.json({
      success: true,
      data: {
        balance: parseFloat(balance?.balance || '0'),
        totalFeesCollected: parseFloat(balance?.total_fees_collected || '0'),
        tierBreakdown: tierBreakdown.map(t => ({
          tier: t.spread_preference,
          count: parseInt(t.count),
          totalFees: parseFloat(t.total_fees),
        })),
        recentFees: recentFees.map(f => ({
          orderId: f.order_id,
          amount: parseFloat(f.fee_amount),
          percentage: parseFloat(f.fee_percentage),
          tier: f.spread_preference,
          createdAt: f.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching platform balance:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch platform balance' },
      { status: 500 }
    );
  }
}
