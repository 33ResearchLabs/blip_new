import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

// GET /api/admin/disputes — Dispute stats: top disputed merchants & users
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    // Top merchants with most disputes against them
    const merchantDisputes = await query<{
      merchant_id: string;
      business_name: string;
      email: string;
      dispute_count: string;
      total_trades: string;
      dispute_rate: string;
      total_disputed_amount: string;
      last_disputed_at: string | null;
    }>(`
      SELECT
        m.id as merchant_id,
        m.business_name,
        COALESCE(m.email, '') as email,
        COUNT(*)::text as dispute_count,
        COALESCE(m.total_trades, 0)::text as total_trades,
        CASE WHEN COALESCE(m.total_trades, 0) > 0
          THEN ROUND((COUNT(*)::numeric / m.total_trades) * 100, 1)::text
          ELSE '0'
        END as dispute_rate,
        COALESCE(SUM(o.crypto_amount), 0)::text as total_disputed_amount,
        MAX(o.disputed_at)::text as last_disputed_at
      FROM orders o
      JOIN merchants m ON m.id = o.merchant_id
      WHERE o.disputed_at IS NOT NULL
      GROUP BY m.id, m.business_name, m.email, m.total_trades
      ORDER BY COUNT(*) DESC, SUM(o.crypto_amount) DESC
      LIMIT 50
    `);

    // Top users with most disputes
    const userDisputes = await query<{
      user_id: string;
      user_name: string;
      email: string;
      dispute_count: string;
      total_trades: string;
      dispute_rate: string;
      total_disputed_amount: string;
      last_disputed_at: string | null;
    }>(`
      SELECT
        u.id as user_id,
        COALESCE(u.name, u.username, 'Unknown') as user_name,
        COALESCE(u.email, '') as email,
        COUNT(*)::text as dispute_count,
        COALESCE(u.total_trades, 0)::text as total_trades,
        CASE WHEN COALESCE(u.total_trades, 0) > 0
          THEN ROUND((COUNT(*)::numeric / u.total_trades) * 100, 1)::text
          ELSE '0'
        END as dispute_rate,
        COALESCE(SUM(o.crypto_amount), 0)::text as total_disputed_amount,
        MAX(o.disputed_at)::text as last_disputed_at
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.disputed_at IS NOT NULL
      GROUP BY u.id, u.name, u.username, u.email, u.total_trades
      ORDER BY COUNT(*) DESC, SUM(o.crypto_amount) DESC
      LIMIT 50
    `);

    // Recent dispute orders with both parties
    const recentDisputes = await query<{
      order_number: string;
      crypto_amount: string;
      status: string;
      disputed_at: string;
      disputed_by: string | null;
      disputed_by_id: string | null;
      user_name: string;
      user_id: string;
      merchant_name: string;
      merchant_id: string;
      cancellation_reason: string | null;
    }>(`
      SELECT
        o.order_number,
        o.crypto_amount::text,
        o.status,
        o.disputed_at::text,
        o.disputed_by,
        o.disputed_by_id::text,
        COALESCE(u.name, u.username, 'Unknown') as user_name,
        o.user_id::text,
        m.business_name as merchant_name,
        o.merchant_id::text,
        o.cancellation_reason
      FROM orders o
      JOIN users u ON u.id = o.user_id
      JOIN merchants m ON m.id = o.merchant_id
      WHERE o.disputed_at IS NOT NULL
      ORDER BY o.disputed_at DESC
      LIMIT 50
    `);

    // Summary stats
    const summary = await query<{
      total_disputes: string;
      total_disputed_volume: string;
      auto_resolved: string;
      active_disputes: string;
    }>(`
      SELECT
        COUNT(*)::text as total_disputes,
        COALESCE(SUM(crypto_amount), 0)::text as total_disputed_volume,
        COUNT(*) FILTER (WHERE status = 'cancelled' AND cancellation_reason ILIKE '%auto%')::text as auto_resolved,
        COUNT(*) FILTER (WHERE status = 'disputed')::text as active_disputes
      FROM orders
      WHERE disputed_at IS NOT NULL
    `);

    return NextResponse.json({
      success: true,
      data: {
        summary: summary[0] ? {
          totalDisputes: parseInt(summary[0].total_disputes),
          totalDisputedVolume: parseFloat(summary[0].total_disputed_volume),
          autoResolved: parseInt(summary[0].auto_resolved),
          activeDisputes: parseInt(summary[0].active_disputes),
        } : { totalDisputes: 0, totalDisputedVolume: 0, autoResolved: 0, activeDisputes: 0 },
        merchants: merchantDisputes.map((m) => ({
          id: m.merchant_id,
          name: m.business_name,
          email: m.email,
          disputeCount: parseInt(m.dispute_count),
          totalTrades: parseInt(m.total_trades),
          disputeRate: parseFloat(m.dispute_rate),
          totalDisputedAmount: parseFloat(m.total_disputed_amount),
          lastDisputedAt: m.last_disputed_at,
        })),
        users: userDisputes.map((u) => ({
          id: u.user_id,
          name: u.user_name,
          email: u.email,
          disputeCount: parseInt(u.dispute_count),
          totalTrades: parseInt(u.total_trades),
          disputeRate: parseFloat(u.dispute_rate),
          totalDisputedAmount: parseFloat(u.total_disputed_amount),
          lastDisputedAt: u.last_disputed_at,
        })),
        recentDisputes: recentDisputes.map((d) => ({
          orderNumber: d.order_number,
          amount: parseFloat(d.crypto_amount),
          status: d.status,
          disputedAt: d.disputed_at,
          disputedBy: d.disputed_by,
          disputedById: d.disputed_by_id,
          userName: d.user_name,
          userId: d.user_id,
          merchantName: d.merchant_name,
          merchantId: d.merchant_id,
          resolution: d.cancellation_reason,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching dispute stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch dispute stats' },
      { status: 500 }
    );
  }
}
