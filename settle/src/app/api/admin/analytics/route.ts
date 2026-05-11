import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

const TIMEFRAME_INTERVALS: Record<string, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '30m': '30 minutes',
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '1month': '30 days',
  'all': '100 years',
};

// Determine chart bucket size based on timeframe
function getChartBucket(tf: string): string {
  switch (tf) {
    case '1m': case '5m': case '15m': case '30m': return '1 minute';
    case '1h': return '5 minutes';
    case '24h': return '1 hour';
    case '7d': return '1 day';
    case '1month': return '1 day';
    case 'all': return '7 days';
    default: return '1 hour';
  }
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const timeframe = searchParams.get('timeframe') || '24h';
  const interval = TIMEFRAME_INTERVALS[timeframe] || '24 hours';
  const bucket = getChartBucket(timeframe);

  try {
    // Volume overview
    const volume = await queryOne<{
      total_volume: string;
      total_fiat_volume: string;
      order_count: string;
    }>(`
      SELECT
        COALESCE(SUM(crypto_amount), 0)::numeric(14,2)::text AS total_volume,
        COALESCE(SUM(fiat_amount), 0)::numeric(14,2)::text AS total_fiat_volume,
        COUNT(*)::text AS order_count
      FROM orders
      WHERE status = 'completed'
        AND created_at > NOW() - INTERVAL '${interval}'
    `);

    // Previous-period totals: same-length window ending where the current window begins.
    // Drives the dashboard's "vs prior period" KPI deltas — replaces the client-side
    // "split current window in halves" trick which inverted direction (e.g. reported
    // +3.5% when volume was actually down 20% over the prior 24h).
    const previous = await queryOne<{
      prev_volume: string;
      prev_fiat_volume: string;
      prev_order_count: string;
      prev_revenue: string;
      prev_fees: string;
    }>(`
      SELECT
        COALESCE(SUM(crypto_amount), 0)::numeric(14,2)::text AS prev_volume,
        COALESCE(SUM(fiat_amount), 0)::numeric(14,2)::text AS prev_fiat_volume,
        COUNT(*)::text AS prev_order_count,
        COALESCE(SUM(
          CASE WHEN protocol_fee_amount IS NOT NULL AND protocol_fee_amount > 0
            THEN protocol_fee_amount
            ELSE crypto_amount * COALESCE(protocol_fee_percentage, 2.50) / 100
          END
        ), 0)::numeric(14,4)::text AS prev_revenue,
        COALESCE(SUM(
          crypto_amount * COALESCE(protocol_fee_percentage, 2.50) / 100
        ), 0)::numeric(14,4)::text AS prev_fees
      FROM orders
      WHERE status = 'completed'
        AND created_at > NOW() - (INTERVAL '${interval}') * 2
        AND created_at <= NOW() - INTERVAL '${interval}'
    `);

    // Volume trend chart
    const volumeTrend = await query<{ bucket: string; volume: string; count: string }>(`
      SELECT
        DATE_TRUNC('${bucket === '1 minute' ? 'minute' : bucket === '5 minutes' ? 'minute' : bucket === '1 hour' ? 'hour' : bucket === '1 day' ? 'day' : 'week'}', created_at)::text AS bucket,
        COALESCE(SUM(crypto_amount), 0)::numeric(14,2)::text AS volume,
        COUNT(*)::text AS count
      FROM orders
      WHERE status = 'completed'
        AND created_at > NOW() - INTERVAL '${interval}'
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    // Buy vs Sell distribution
    const buySell = await query<{ type: string; count: string; volume: string }>(`
      SELECT
        type,
        COUNT(*)::text AS count,
        COALESCE(SUM(crypto_amount), 0)::numeric(14,2)::text AS volume
      FROM orders
      WHERE status = 'completed'
        AND created_at > NOW() - INTERVAL '${interval}'
      GROUP BY type
    `);

    // Revenue and fees
    const revenue = await queryOne<{
      total_revenue: string;
      total_fees: string;
      avg_fee: string;
    }>(`
      SELECT
        COALESCE(SUM(
          CASE WHEN protocol_fee_amount IS NOT NULL AND protocol_fee_amount > 0
            THEN protocol_fee_amount
            ELSE crypto_amount * COALESCE(protocol_fee_percentage, 2.50) / 100
          END
        ), 0)::numeric(14,4)::text AS total_revenue,
        COALESCE(SUM(
          crypto_amount * COALESCE(protocol_fee_percentage, 2.50) / 100
        ), 0)::numeric(14,4)::text AS total_fees,
        COALESCE(AVG(
          CASE WHEN protocol_fee_amount IS NOT NULL AND protocol_fee_amount > 0
            THEN protocol_fee_amount
            ELSE crypto_amount * COALESCE(protocol_fee_percentage, 2.50) / 100
          END
        ), 0)::numeric(14,4)::text AS avg_fee
      FROM orders
      WHERE status = 'completed'
        AND created_at > NOW() - INTERVAL '${interval}'
    `);

    // Orders analytics.
    // NOTE: `cancelled` keeps its legacy semantics (cancelled OR expired) for
    // backward compatibility with any cached client. New fields `cancelled_only`
    // and `expired` are exposed separately so the UI can render honest chips.
    const ordersAnalytics = await queryOne<{
      total_orders: string;
      completed: string;
      cancelled: string;
      cancelled_only: string;
      expired: string;
      disputed: string;
      pending: string;
      active: string;
      avg_size: string;
      avg_completion_seconds: string;
    }>(`
      SELECT
        COUNT(*)::text AS total_orders,
        COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
        COUNT(*) FILTER (WHERE status IN ('cancelled', 'expired'))::text AS cancelled,
        COUNT(*) FILTER (WHERE status = 'cancelled')::text AS cancelled_only,
        COUNT(*) FILTER (WHERE status = 'expired')::text AS expired,
        COUNT(*) FILTER (WHERE status = 'disputed')::text AS disputed,
        -- Pending = orders waiting for a counterparty (no acceptance yet)
        COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
        -- Active = in-progress (claimed/escrowed/payment_sent)
        COUNT(*) FILTER (WHERE status IN ('accepted', 'escrowed', 'payment_sent', 'payment_pending', 'payment_confirmed', 'releasing'))::text AS active,
        COALESCE(AVG(crypto_amount) FILTER (WHERE status = 'completed'), 0)::numeric(14,2)::text AS avg_size,
        COALESCE(
          EXTRACT(EPOCH FROM AVG(completed_at - created_at) FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL)),
          0
        )::numeric(10,0)::text AS avg_completion_seconds
      FROM orders
      WHERE created_at > NOW() - INTERVAL '${interval}'
    `);

    // User activity — counts merchants on BOTH sides of the order so M2M
    // acceptors (buyer_merchant_id) aren't invisible to the "active merchants"
    // metric.
    const userActivity = await queryOne<{
      new_users: string;
      active_merchants: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '${interval}')::text AS new_users,
        (SELECT COUNT(DISTINCT mid) FROM (
           SELECT merchant_id AS mid FROM orders
           WHERE created_at > NOW() - INTERVAL '${interval}'
             AND merchant_id IS NOT NULL
           UNION
           SELECT buyer_merchant_id FROM orders
           WHERE created_at > NOW() - INTERVAL '${interval}'
             AND buyer_merchant_id IS NOT NULL
         ) sides)::text AS active_merchants
    `);

    // Top traders — credit BOTH sides of an M2M trade.
    // Previously joined only on merchant_id (seller), which hid the buyer-side
    // merchant's volume entirely and could flip the ranking. We now UNION ALL
    // both sides so a trade that involves two merchants contributes the same
    // crypto_amount to each side's total — matches "who actually traded".
    // (Sum of top-trader volumes can exceed total_volume — that's expected for
    // a participation metric, not a volume-of-record metric.)
    const topTraders = await query<{
      name: string;
      volume: string;
      trades: string;
    }>(`
      WITH merchant_sides AS (
        SELECT merchant_id AS mid, crypto_amount
        FROM orders
        WHERE status = 'completed'
          AND created_at > NOW() - INTERVAL '${interval}'
          AND merchant_id IS NOT NULL
        UNION ALL
        SELECT buyer_merchant_id AS mid, crypto_amount
        FROM orders
        WHERE status = 'completed'
          AND created_at > NOW() - INTERVAL '${interval}'
          AND buyer_merchant_id IS NOT NULL
      )
      SELECT
        m.business_name AS name,
        COALESCE(SUM(ms.crypto_amount), 0)::numeric(14,2)::text AS volume,
        COUNT(*)::text AS trades
      FROM merchant_sides ms
      JOIN merchants m ON m.id = ms.mid
      GROUP BY m.id, m.business_name
      ORDER BY SUM(ms.crypto_amount) DESC
      LIMIT 5
    `);

    // Risk metrics
    const risk = await queryOne<{
      dispute_rate: string;
      failed_count: string;
      escrow_locked: string;
    }>(`
      SELECT
        CASE
          WHEN COUNT(*) FILTER (WHERE status IN ('completed', 'disputed')) = 0 THEN '0'
          ELSE (COUNT(*) FILTER (WHERE status = 'disputed') * 100.0 /
                NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'disputed')), 0))::numeric(5,2)::text
        END AS dispute_rate,
        COUNT(*) FILTER (WHERE status IN ('cancelled', 'expired'))::text AS failed_count,
        (SELECT COALESCE(SUM(crypto_amount), 0) FROM orders
         WHERE status IN ('escrowed', 'payment_sent', 'payment_confirmed'))::numeric(14,2)::text AS escrow_locked
      FROM orders
      WHERE created_at > NOW() - INTERVAL '${interval}'
    `);

    // Live activity feed (last 15 trades)
    const liveFeed = await query<{
      id: string;
      order_number: string;
      type: string;
      crypto_amount: string;
      fiat_amount: string;
      status: string;
      created_at: string;
      merchant_name: string;
    }>(`
      SELECT
        o.id,
        o.order_number,
        o.type,
        o.crypto_amount::numeric(14,2)::text,
        o.fiat_amount::numeric(14,2)::text,
        o.status,
        o.created_at::text,
        COALESCE(m.business_name, 'Unknown') AS merchant_name
      FROM orders o
      LEFT JOIN merchants m ON o.merchant_id = m.id
      ORDER BY o.created_at DESC
      LIMIT 15
    `);

    const totalOrders = parseInt(ordersAnalytics?.total_orders || '0');
    const completedCount = parseInt(ordersAnalytics?.completed || '0');
    const cancelledCount = parseInt(ordersAnalytics?.cancelled || '0');
    const successRate = totalOrders > 0
      ? ((completedCount / (completedCount + cancelledCount)) * 100) || 0
      : 0;

    const response = {
      timeframe,
      // Previous-period totals (same-length window immediately before the
      // current one). Drives client-side delta computation — replaces the
      // half-window momentum trick that inverted direction.
      previous: {
        volume: parseFloat(previous?.prev_volume || '0'),
        fiatVolume: parseFloat(previous?.prev_fiat_volume || '0'),
        orderCount: parseInt(previous?.prev_order_count || '0'),
        revenue: parseFloat(previous?.prev_revenue || '0'),
        fees: parseFloat(previous?.prev_fees || '0'),
      },
      volume: {
        total: parseFloat(volume?.total_volume || '0'),
        totalFiat: parseFloat(volume?.total_fiat_volume || '0'),
        orderCount: parseInt(volume?.order_count || '0'),
        trend: (volumeTrend || []).map(v => ({
          time: v.bucket,
          volume: parseFloat(v.volume),
          count: parseInt(v.count),
        })),
      },
      buySell: (buySell || []).map(bs => ({
        type: bs.type,
        count: parseInt(bs.count),
        volume: parseFloat(bs.volume),
      })),
      revenue: {
        total: parseFloat(revenue?.total_revenue || '0'),
        fees: parseFloat(revenue?.total_fees || '0'),
        avgFee: parseFloat(revenue?.avg_fee || '0'),
      },
      orders: {
        total: totalOrders,
        completed: completedCount,
        // `cancelled` is the legacy combined bucket (cancelled OR expired)
        // — kept for backward compatibility. Prefer `cancelledOnly` + `expired`
        // for honest UI labelling.
        cancelled: cancelledCount,
        cancelledOnly: parseInt(ordersAnalytics?.cancelled_only || '0'),
        expired: parseInt(ordersAnalytics?.expired || '0'),
        disputed: parseInt(ordersAnalytics?.disputed || '0'),
        pending: parseInt(ordersAnalytics?.pending || '0'),
        active: parseInt(ordersAnalytics?.active || '0'),
        successRate: Number(successRate.toFixed(1)),
        avgSize: parseFloat(ordersAnalytics?.avg_size || '0'),
        avgCompletionSeconds: parseInt(ordersAnalytics?.avg_completion_seconds || '0'),
      },
      users: {
        newUsers: parseInt(userActivity?.new_users || '0'),
        activeMerchants: parseInt(userActivity?.active_merchants || '0'),
        topTraders: (topTraders || []).map((t, i) => {
          const emojis = ['🏪', '💎', '👑', '🛡️', '⚡', '🌟', '💰', '🔥', '🦊', '🐋'];
          return {
            name: t.name,
            emoji: emojis[i % emojis.length],
            volume: parseFloat(t.volume),
            trades: parseInt(t.trades),
          };
        }),
      },
      risk: {
        disputeRate: parseFloat(risk?.dispute_rate || '0'),
        failedCount: parseInt(risk?.failed_count || '0'),
        escrowLocked: parseFloat(risk?.escrow_locked || '0'),
      },
      liveFeed: (liveFeed || []).map(f => ({
        id: f.id,
        orderNumber: f.order_number,
        type: f.type,
        amount: parseFloat(f.crypto_amount),
        fiatAmount: parseFloat(f.fiat_amount),
        status: f.status,
        createdAt: f.created_at,
        merchant: f.merchant_name,
      })),
    };

    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    console.error('Error fetching admin analytics:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}
