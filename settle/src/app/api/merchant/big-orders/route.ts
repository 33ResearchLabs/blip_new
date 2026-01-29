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
 * GET /api/merchant/big-orders
 *
 * Retrieves big orders for a merchant
 * Big orders are defined as orders above the merchant's threshold or marked as custom
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const includeCompleted = searchParams.get('include_completed') === 'true';

    if (!merchantId) {
      return validationErrorResponse(['merchant_id is required']);
    }

    // Authorization check
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchantId;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only access your own big orders');
      }
    }

    // Verify merchant exists and get threshold
    const merchantResult = await query(
      `SELECT id, big_order_threshold FROM merchants WHERE id = $1 AND status = 'active'`,
      [merchantId]
    );

    if (merchantResult.length === 0) {
      return validationErrorResponse(['Merchant not found']);
    }

    const threshold = (merchantResult[0] as { big_order_threshold?: number }).big_order_threshold || 10000;

    // Build query for big orders
    let bigOrdersQuery = `
      SELECT
        o.id,
        o.order_number,
        o.status,
        o.type,
        o.crypto_amount,
        o.crypto_currency,
        o.fiat_amount,
        o.fiat_currency,
        o.rate,
        o.payment_method,
        o.is_custom,
        o.custom_notes,
        o.premium_percent,
        o.created_at,
        o.expires_at,
        json_build_object(
          'id', u.id,
          'username', u.username,
          'rating', u.rating,
          'total_trades', u.total_trades,
          'total_volume', u.total_volume
        ) as user
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.merchant_id = $1
        AND (o.fiat_amount >= $2 OR o.is_custom = true)
    `;

    const queryParams: (string | number | boolean)[] = [merchantId, threshold];
    let paramIndex = 3;

    // Filter by status
    if (!includeCompleted) {
      bigOrdersQuery += ` AND o.status NOT IN ('completed', 'cancelled', 'expired')`;
    }

    bigOrdersQuery += `
      ORDER BY
        CASE WHEN o.status = 'pending' THEN 0 ELSE 1 END,
        o.is_custom DESC,
        o.fiat_amount DESC,
        o.created_at DESC
      LIMIT $${paramIndex}
    `;
    queryParams.push(limit);

    const result = await query(bigOrdersQuery, queryParams);

    // Get stats
    const statsResult = await query(
      `SELECT
        COUNT(*) FILTER (WHERE fiat_amount >= $2 OR is_custom = true) as total_big_orders,
        COUNT(*) FILTER (WHERE (fiat_amount >= $2 OR is_custom = true) AND status = 'pending') as pending_big_orders,
        COALESCE(SUM(fiat_amount) FILTER (WHERE (fiat_amount >= $2 OR is_custom = true) AND status = 'completed'), 0) as completed_volume
      FROM orders
      WHERE merchant_id = $1 AND status NOT IN ('cancelled', 'expired')`,
      [merchantId, threshold]
    );

    const stats = (statsResult[0] as { total_big_orders: string; pending_big_orders: string; completed_volume: string }) || {
      total_big_orders: '0',
      pending_big_orders: '0',
      completed_volume: '0',
    };

    return successResponse({
      orders: result,
      threshold,
      stats: {
        totalBigOrders: parseInt(stats.total_big_orders) || 0,
        pendingBigOrders: parseInt(stats.pending_big_orders) || 0,
        completedVolume: parseFloat(stats.completed_volume) || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching big orders:', error);
    return errorResponse('Internal server error');
  }
}

/**
 * PATCH /api/merchant/big-orders
 *
 * Update merchant's big order threshold
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { merchant_id, threshold } = body;

    if (!merchant_id) {
      return validationErrorResponse(['merchant_id is required']);
    }

    if (threshold === undefined || threshold < 0) {
      return validationErrorResponse(['Valid threshold is required']);
    }

    // Authorization check
    const auth = getAuthContext(request, body);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchant_id;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only update your own settings');
      }
    }

    // Verify merchant exists
    const merchantExists = await verifyMerchant(merchant_id);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    // Update threshold
    await query(
      `UPDATE merchants SET big_order_threshold = $1 WHERE id = $2`,
      [threshold, merchant_id]
    );

    return successResponse({ threshold });
  } catch (error) {
    console.error('Error updating big order threshold:', error);
    return errorResponse('Internal server error');
  }
}
