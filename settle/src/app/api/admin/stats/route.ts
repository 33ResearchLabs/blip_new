import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

interface StatsRow {
  total_trades: string;
  open_orders: string;
  volume_24h: string;
  active_merchants: string;
  escrow_locked: string;
  active_disputes: string;
  total_users: string;
  total_merchants: string;
}

interface ChangeRow {
  current: string;
  previous: string;
}

// GET /api/admin/stats - Get platform statistics
export async function GET() {
  try {
    // Get core stats
    const stats = await queryOne<StatsRow>(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE status = 'completed')::text as total_trades,
        (SELECT COUNT(*) FROM orders WHERE status IN ('pending', 'accepted', 'escrowed', 'payment_sent', 'payment_confirmed'))::text as open_orders,
        (SELECT COALESCE(SUM(crypto_amount), 0) FROM orders WHERE status = 'completed' AND created_at > NOW() - INTERVAL '24 hours')::text as volume_24h,
        (SELECT COUNT(*) FROM merchants WHERE is_online = true)::text as active_merchants,
        (SELECT COALESCE(SUM(crypto_amount), 0) FROM orders WHERE status IN ('escrowed', 'payment_sent', 'payment_confirmed'))::text as escrow_locked,
        (SELECT COUNT(*) FROM disputes WHERE status IN ('open', 'investigating'))::text as active_disputes,
        (SELECT COUNT(*) FROM users)::text as total_users,
        (SELECT COUNT(*) FROM merchants)::text as total_merchants
    `);

    // Calculate 24h change for trades
    const tradesChange = await queryOne<ChangeRow>(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE status = 'completed' AND created_at > NOW() - INTERVAL '24 hours')::text as current,
        (SELECT COUNT(*) FROM orders WHERE status = 'completed' AND created_at > NOW() - INTERVAL '48 hours' AND created_at <= NOW() - INTERVAL '24 hours')::text as previous
    `);

    // Calculate 24h change for volume
    const volumeChange = await queryOne<ChangeRow>(`
      SELECT
        (SELECT COALESCE(SUM(crypto_amount), 0) FROM orders WHERE status = 'completed' AND created_at > NOW() - INTERVAL '24 hours')::text as current,
        (SELECT COALESCE(SUM(crypto_amount), 0) FROM orders WHERE status = 'completed' AND created_at > NOW() - INTERVAL '48 hours' AND created_at <= NOW() - INTERVAL '24 hours')::text as previous
    `);

    // Get success rate (completed / total non-pending)
    const successRate = await queryOne<{ rate: string }>(`
      SELECT
        CASE
          WHEN COUNT(*) FILTER (WHERE status IN ('completed', 'cancelled', 'expired', 'disputed')) = 0 THEN '100'
          ELSE (COUNT(*) FILTER (WHERE status = 'completed') * 100.0 /
                NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'cancelled', 'expired', 'disputed')), 0))::numeric(5,2)::text
        END as rate
      FROM orders
    `);

    // Get average completion time (in minutes)
    const avgTime = await queryOne<{ avg_minutes: string }>(`
      SELECT COALESCE(
        EXTRACT(EPOCH FROM AVG(completed_at - created_at)) / 60,
        0
      )::numeric(10,1)::text as avg_minutes
      FROM orders
      WHERE status = 'completed'
      AND completed_at > NOW() - INTERVAL '7 days'
    `);

    // Get platform revenue (sum of fees from completed orders)
    // Assuming 0.5% platform fee
    const revenue = await queryOne<{ total: string }>(`
      SELECT COALESCE(SUM(crypto_amount * 0.005), 0)::numeric(10,2)::text as total
      FROM orders
      WHERE status = 'completed'
    `);

    // Calculate percentage changes
    const calcChange = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number(((current - previous) / previous * 100).toFixed(1));
    };

    const response = {
      totalTrades: parseInt(stats?.total_trades || '0'),
      totalTradesChange: calcChange(
        parseInt(tradesChange?.current || '0'),
        parseInt(tradesChange?.previous || '0')
      ),
      openOrders: parseInt(stats?.open_orders || '0'),
      volume24h: parseFloat(stats?.volume_24h || '0'),
      volume24hChange: calcChange(
        parseFloat(volumeChange?.current || '0'),
        parseFloat(volumeChange?.previous || '0')
      ),
      activeMerchants: parseInt(stats?.active_merchants || '0'),
      escrowLocked: parseFloat(stats?.escrow_locked || '0'),
      disputes: parseInt(stats?.active_disputes || '0'),
      successRate: parseFloat(successRate?.rate || '100'),
      avgTime: parseFloat(avgTime?.avg_minutes || '0'),
      revenue: parseFloat(revenue?.total || '0'),
      totalUsers: parseInt(stats?.total_users || '0'),
      totalMerchants: parseInt(stats?.total_merchants || '0'),
    };

    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
