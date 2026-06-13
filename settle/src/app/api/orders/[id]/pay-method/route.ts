import { NextRequest, NextResponse } from 'next/server';
import { setBuyOrderMerchantPaymentMethod } from '@/lib/db/repositories/orders';
import { uuidSchema } from '@/lib/validation/schemas';
import {
  requireAuth,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  errorResponse,
  successResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

/**
 * POST /api/orders/[id]/pay-method
 *
 * Buyer of a broadcast BUY order picks which of the assigned merchant's
 * matching payment accounts they will pay into. Sets the order's
 * merchant_payment_method_id (validated server-side: must be the buyer's own
 * buy order, a merchant must be assigned, and the chosen method must belong to
 * that merchant, be active, and match one of the buyer's offered types).
 *
 * Body: { method_id: string (uuid) }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const idResult = uuidSchema.safeParse(id);
    if (!idResult.success) {
      return validationErrorResponse(['Invalid order id']);
    }

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Only the BUYER may choose where to pay. The buyer is a user (their own
    // buy order) or a merchant (a merchant-placed buy order). The repo verifies
    // the actor actually owns the order as the buyer; here we just exclude
    // other actor types (e.g. compliance).
    if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
      return forbiddenResponse('Only the buyer can choose a payment method');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return validationErrorResponse(['Invalid JSON body']);
    }

    const methodResult = uuidSchema.safeParse((body as { method_id?: unknown })?.method_id);
    if (!methodResult.success) {
      return validationErrorResponse(['method_id is required']);
    }

    const result = await setBuyOrderMerchantPaymentMethod(
      idResult.data,
      methodResult.data,
      auth.actorType,
      auth.actorId,
    );

    if (!result.ok) {
      switch (result.reason) {
        case 'not_found':
          return notFoundResponse('Order');
        case 'not_buyer':
          return forbiddenResponse('You can only set the payment method on your own order');
        case 'not_buy':
          return validationErrorResponse(['Only buy orders have a pay-into method']);
        case 'no_merchant':
          return validationErrorResponse(['No merchant has accepted this order yet']);
        case 'bad_status':
          return validationErrorResponse(['Payment method can no longer be changed for this order']);
        case 'invalid_method':
          return validationErrorResponse(["That method is not one of the merchant's matching accounts"]);
        default:
          return errorResponse('Could not set payment method');
      }
    }

    logger.api.request('POST', `/api/orders/${id}/pay-method`, auth.actorId);
    return successResponse({ id: idResult.data, merchant_payment_method_id: methodResult.data });
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/pay-method', error as Error);
    return errorResponse('Internal server error');
  }
}
