import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { MOCK_MODE, MOCK_INITIAL_BALANCE } from '@/lib/config/mockMode';

/**
 * POST /api/setup/init-balances
 * Initialize all user and merchant balances to MOCK_INITIAL_BALANCE
 * Only works in MOCK_MODE
 */
export async function POST(request: NextRequest) {
  if (!MOCK_MODE) {
    return NextResponse.json({ error: 'Only available in mock mode' }, { status: 403 });
  }

  try {
    console.log(`[Init Balances] Starting balance initialization to ${MOCK_INITIAL_BALANCE}...`);

    // Update users with 0 or null balance
    const usersResult = await query(
      'UPDATE users SET balance = $1 WHERE balance IS NULL OR balance = 0 RETURNING id, display_name, balance',
      [MOCK_INITIAL_BALANCE]
    );

    console.log(`[Init Balances] Updated ${usersResult?.length || 0} users`);

    // Update merchants with 0 or null balance
    const merchantsResult = await query(
      'UPDATE merchants SET balance = $1 WHERE balance IS NULL OR balance = 0 RETURNING id, display_name, balance',
      [MOCK_INITIAL_BALANCE]
    );

    console.log(`[Init Balances] Updated ${merchantsResult?.length || 0} merchants`);

    // Get summary
    const userStats = await query('SELECT COUNT(*) as count, SUM(balance) as total FROM users');
    const merchantStats = await query('SELECT COUNT(*) as count, SUM(balance) as total FROM merchants');

    const summary = {
      usersUpdated: usersResult?.length || 0,
      merchantsUpdated: merchantsResult?.length || 0,
      totalUsers: parseInt(userStats?.[0]?.count || '0'),
      totalMerchants: parseInt(merchantStats?.[0]?.count || '0'),
      totalUserBalance: parseFloat(userStats?.[0]?.total || '0'),
      totalMerchantBalance: parseFloat(merchantStats?.[0]?.total || '0'),
    };

    console.log('[Init Balances] Summary:', summary);

    return NextResponse.json({
      success: true,
      message: `Initialized ${summary.usersUpdated} users and ${summary.merchantsUpdated} merchants with ${MOCK_INITIAL_BALANCE} USDT`,
      data: summary,
    });
  } catch (error) {
    console.error('[Init Balances] Error:', error);
    return NextResponse.json(
      { error: 'Failed to initialize balances', details: (error as Error).message },
      { status: 500 }
    );
  }
}
