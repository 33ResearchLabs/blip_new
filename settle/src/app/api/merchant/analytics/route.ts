import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import {
  getAuthContext,
  verifyMerchant,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';

/**
 * GET /api/merchant/analytics
 *
 * Retrieves analytics data for a merchant dashboard
 * Includes volume, trade counts, revenue, and activity data
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const period = searchParams.get('period') || '30d'; // 7d, 30d, 90d, all

    if (!merchantId) {
      return validationErrorResponse(['merchant_id is required']);
    }

    // Authorization check
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchantId;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only access your own analytics');
      }
    }

    // Verify merchant exists
    const merchantExists = await verifyMerchant(merchantId);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    // Calculate date range
    let dateFilter = '';
    const periodDays: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
    if (period !== 'all' && periodDays[period]) {
      dateFilter = `AND o.created_at >= NOW() - INTERVAL '${periodDays[period]} days'`;
    }

    // Get summary stats
    const summaryResult = await query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'completed') as completed_trades,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_trades,
        COUNT(*) FILTER (WHERE status = 'disputed') as disputed_trades,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_trades,
        COALESCE(SUM(fiat_amount) FILTER (WHERE status = 'completed'), 0) as total_volume,
        COALESCE(SUM(crypto_amount) FILTER (WHERE status = 'completed'), 0) as total_crypto_volume,
        COALESCE(AVG(fiat_amount) FILTER (WHERE status = 'completed'), 0) as avg_order_size,
        COUNT(DISTINCT user_id) FILTER (WHERE status = 'completed') as unique_customers
      FROM orders o
      WHERE o.merchant_id = $1 ${dateFilter}`,
      [merchantId]
    );

    interface SummaryRow {
      completed_trades: string;
      pending_trades: string;
      disputed_trades: string;
      cancelled_trades: string;
      total_volume: string;
      total_crypto_volume: string;
      avg_order_size: string;
      unique_customers: string;
    }
    const summary = (summaryResult[0] as SummaryRow) || {
      completed_trades: '0',
      pending_trades: '0',
      disputed_trades: '0',
      cancelled_trades: '0',
      total_volume: '0',
      total_crypto_volume: '0',
      avg_order_size: '0',
      unique_customers: '0',
    };

    // Calculate revenue (0.5% trader cut)
    const traderCut = 0.005;
    const totalRevenue = parseFloat(summary.total_volume || '0') * traderCut;

    // Get daily volume for chart (last 30 days)
    const dailyVolumeResult = await query(
      `SELECT
        DATE(o.created_at) as date,
        COUNT(*) FILTER (WHERE status = 'completed') as trades,
        COALESCE(SUM(fiat_amount) FILTER (WHERE status = 'completed'), 0) as volume,
        COALESCE(SUM(fiat_amount * 0.005) FILTER (WHERE status = 'completed'), 0) as revenue
      FROM orders o
      WHERE o.merchant_id = $1
        AND o.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(o.created_at)
      ORDER BY date`,
      [merchantId]
    );

    // Get hourly activity heatmap (last 7 days)
    const hourlyActivityResult = await query(
      `SELECT
        EXTRACT(DOW FROM created_at) as day_of_week,
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as order_count
      FROM orders
      WHERE merchant_id = $1
        AND created_at >= NOW() - INTERVAL '30 days'
        AND status = 'completed'
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour`,
      [merchantId]
    );

    // Get top customers by volume
    const topCustomersResult = await query(
      `SELECT
        u.id,
        u.username,
        u.rating,
        u.total_trades,
        COUNT(*) as order_count,
        COALESCE(SUM(o.fiat_amount) FILTER (WHERE o.status = 'completed'), 0) as total_volume
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.merchant_id = $1
        AND o.status = 'completed'
        ${dateFilter}
      GROUP BY u.id, u.username, u.rating, u.total_trades
      ORDER BY total_volume DESC
      LIMIT 5`,
      [merchantId]
    );

    // Get trade status breakdown
    const statusBreakdownResult = await query(
      `SELECT
        status,
        COUNT(*) as count,
        COALESCE(SUM(fiat_amount), 0) as volume
      FROM orders
      WHERE merchant_id = $1 ${dateFilter}
      GROUP BY status
      ORDER BY count DESC`,
      [merchantId]
    );

    // Get payment method breakdown
    const paymentMethodResult = await query(
      `SELECT
        payment_method,
        COUNT(*) as count,
        COALESCE(SUM(fiat_amount) FILTER (WHERE status = 'completed'), 0) as volume
      FROM orders
      WHERE merchant_id = $1
        AND status = 'completed'
        ${dateFilter}
      GROUP BY payment_method`,
      [merchantId]
    );

    // Calculate average completion time
    const avgCompletionResult = await query(
      `SELECT
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60) as avg_minutes
      FROM orders
      WHERE merchant_id = $1
        AND status = 'completed'
        AND completed_at IS NOT NULL
        ${dateFilter}`,
      [merchantId]
    );

    // Build hourly heatmap (7 days x 24 hours)
    const heatmapData: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
    for (const row of hourlyActivityResult as Array<{day_of_week: string; hour: string; order_count: string}>) {
      const dayIdx = parseInt(row.day_of_week);
      const hourIdx = parseInt(row.hour);
      heatmapData[dayIdx][hourIdx] = parseInt(row.order_count);
    }

    return successResponse({
      period,
      summary: {
        completedTrades: parseInt(summary.completed_trades) || 0,
        pendingTrades: parseInt(summary.pending_trades) || 0,
        disputedTrades: parseInt(summary.disputed_trades) || 0,
        cancelledTrades: parseInt(summary.cancelled_trades) || 0,
        totalVolume: parseFloat(summary.total_volume) || 0,
        totalCryptoVolume: parseFloat(summary.total_crypto_volume) || 0,
        avgOrderSize: parseFloat(summary.avg_order_size) || 0,
        uniqueCustomers: parseInt(summary.unique_customers) || 0,
        totalRevenue,
        avgCompletionMinutes: parseFloat((avgCompletionResult[0] as {avg_minutes?: string})?.avg_minutes || '0') || 0,
      },
      charts: {
        dailyVolume: (dailyVolumeResult as Array<{date: string; trades: string; volume: string; revenue: string}>).map(row => ({
          date: row.date,
          trades: parseInt(row.trades),
          volume: parseFloat(row.volume),
          revenue: parseFloat(row.revenue),
        })),
        hourlyHeatmap: heatmapData,
        statusBreakdown: (statusBreakdownResult as Array<{status: string; count: string; volume: string}>).map(row => ({
          status: row.status,
          count: parseInt(row.count),
          volume: parseFloat(row.volume),
        })),
        paymentMethods: (paymentMethodResult as Array<{payment_method: string; count: string; volume: string}>).map(row => ({
          method: row.payment_method,
          count: parseInt(row.count),
          volume: parseFloat(row.volume),
        })),
      },
      topCustomers: (topCustomersResult as Array<{id: string; username: string; rating: string; total_trades: string; order_count: string; total_volume: string}>).map(row => ({
        id: row.id,
        username: row.username,
        rating: parseFloat(row.rating) || 0,
        totalTrades: parseInt(row.total_trades) || 0,
        orderCount: parseInt(row.order_count),
        totalVolume: parseFloat(row.total_volume),
      })),
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return errorResponse('Internal server error');
  }
}
