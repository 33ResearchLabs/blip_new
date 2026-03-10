import { NextRequest, NextResponse } from 'next/server';
import {
  getMempoolOrders,
  getMineableOrdersForMerchant,
  bumpOrderPriority,
  acceptOrder,
  getCorridorPrice,
  getMerchantQuote,
  getActiveMerchantQuotes,
  getOrderEvents,
  calculateRefPriceFromTrades,
} from '@/lib/db/repositories/mempool';
import {
  requireAuth,
  validationErrorResponse,
  successResponse,
  errorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit, STANDARD_LIMIT, STRICT_LIMIT } from '@/lib/middleware/rateLimit';

// GET /api/mempool - Get mempool orders or market data
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type'); // 'orders', 'mineable', 'corridor', 'quotes', 'events'
    const corridorId = searchParams.get('corridor_id') || 'USDT_AED';
    const merchantId = searchParams.get('merchant_id');
    const orderId = searchParams.get('order_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Get mempool orders with filters
    if (!type || type === 'orders') {
      const minPremiumBps = searchParams.get('min_premium_bps');
      const maxPremiumBps = searchParams.get('max_premium_bps');
      const minAmount = searchParams.get('min_amount');
      const maxAmount = searchParams.get('max_amount');

      const orders = await getMempoolOrders({
        corridor_id: corridorId,
        min_premium_bps: minPremiumBps ? parseInt(minPremiumBps, 10) : undefined,
        max_premium_bps: maxPremiumBps ? parseInt(maxPremiumBps, 10) : undefined,
        min_amount: minAmount ? parseFloat(minAmount) : undefined,
        max_amount: maxAmount ? parseFloat(maxAmount) : undefined,
        limit,
        offset,
      });

      return successResponse({ orders });
    }

    // Get mineable orders for a merchant
    if (type === 'mineable') {
      if (!merchantId) {
        return validationErrorResponse(['merchant_id is required for mineable orders']);
      }

      // Authorization check (DB-verified)
      const auth = await requireAuth(request);
      if (auth instanceof NextResponse) return auth;
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchantId;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only view your own mineable orders');
      }

      const orders = await getMineableOrdersForMerchant(merchantId, corridorId);
      return successResponse({ orders });
    }

    // Get corridor price data
    if (type === 'corridor') {
      const corridor = await getCorridorPrice(corridorId);

      // Also calculate current ref price from recent trades
      const calculatedRefPrice = await calculateRefPriceFromTrades(corridorId, 5);

      return successResponse({
        corridor,
        calculated_ref_price: calculatedRefPrice,
      });
    }

    // Get merchant quotes
    if (type === 'quotes') {
      if (merchantId) {
        // Get specific merchant quote
        const quote = await getMerchantQuote(merchantId, corridorId);
        return successResponse({ quote });
      } else {
        // Get all active quotes
        const quotes = await getActiveMerchantQuotes(corridorId);
        return successResponse({ quotes });
      }
    }

    // Get order events
    if (type === 'events' && orderId) {
      const events = await getOrderEvents(orderId, limit);
      return successResponse({ events });
    }

    return validationErrorResponse(['Invalid query parameters']);
  } catch (error) {
    console.error('Error fetching mempool data:', error);
    return errorResponse('Internal server error');
  }
}

// POST /api/mempool - Perform mempool actions (bump, accept)
export async function POST(request: NextRequest) {
  // Rate limit mutations
  const rl = checkRateLimit(request, 'mempool:post', STRICT_LIMIT);
  if (rl) return rl;

  // Require auth for all mempool mutations
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { action, order_id, merchant_id, is_auto } = body;

    if (!action) {
      return validationErrorResponse(['action is required']);
    }

    // Bump order priority
    if (action === 'bump') {
      if (!order_id) {
        return validationErrorResponse(['order_id is required for bump action']);
      }

      const result = await bumpOrderPriority(order_id, is_auto || false);

      return successResponse({
        ...result,
        message: result.max_reached
          ? 'Order bumped to maximum priority'
          : 'Order priority increased',
      });
    }

    // Accept order
    if (action === 'accept') {
      if (!order_id || !merchant_id) {
        return validationErrorResponse(['order_id and merchant_id are required for accept action']);
      }

      // Authorization check (auth already verified above)
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchant_id;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only accept orders as yourself');
      }

      // Self-accept guard: cannot accept your own order
      const { queryOne } = await import('@/lib/db');
      const orderRow = await queryOne<{ creator_merchant_id: string | null }>(
        'SELECT creator_merchant_id FROM orders WHERE id = $1',
        [order_id]
      );
      if (orderRow?.creator_merchant_id === merchant_id) {
        return validationErrorResponse(['You cannot accept your own order']);
      }

      const result = await acceptOrder(order_id, merchant_id);

      if (!result.success) {
        return validationErrorResponse([result.message]);
      }

      return successResponse({ message: result.message });
    }

    return validationErrorResponse(['Invalid action']);
  } catch (error) {
    console.error('Error performing mempool action:', error);

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return validationErrorResponse([error.message]);
      }
      if (error.message.includes('not pending')) {
        return validationErrorResponse([error.message]);
      }
    }

    return errorResponse('Internal server error');
  }
}
