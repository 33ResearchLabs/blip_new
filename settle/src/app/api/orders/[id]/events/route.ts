import { NextRequest } from 'next/server';
import { getOrderEvents, getOrderById } from '@/lib/db/repositories/orders';
import { uuidSchema } from '@/lib/validation/schemas';
import {
  getAuthContext,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';
import { serializeOrder } from '@/lib/api/orderSerializer';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idResult = uuidSchema.safeParse(id);
    if (!idResult.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    // Get auth context from query params
    const auth = getAuthContext(request);

    // Fetch order to verify it exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Check authorization if auth context provided
    if (auth) {
      const canAccess = await canAccessOrder(auth, id);
      if (!canAccess) {
        logger.auth.forbidden(`GET /api/orders/${id}/events`, auth.actorId, 'Not order participant');
        return forbiddenResponse('You do not have access to this order');
      }
    }

    // Fetch order events
    const events = await getOrderEvents(id);

    // Include order payment_details and escrow info for rich card rendering
    const enrichedResponse = {
      events,
      orderContext: serializeOrder({
        payment_details: order.payment_details,
        escrow_tx_hash: order.escrow_tx_hash,
        escrow_pda: order.escrow_pda,
        escrow_trade_pda: order.escrow_trade_pda,
        escrow_trade_id: order.escrow_trade_id,
        release_tx_hash: order.release_tx_hash,
        crypto_amount: order.crypto_amount,
        crypto_currency: order.crypto_currency,
        fiat_amount: order.fiat_amount,
        fiat_currency: order.fiat_currency,
        order_number: order.order_number,
        type: order.type,
        status: order.status,
      }),
    };

    logger.api.request('GET', `/api/orders/${id}/events`, auth?.actorId);
    return successResponse(enrichedResponse);
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/events', error as Error);
    return errorResponse('Internal server error');
  }
}
