import { NextRequest } from 'next/server';
import { getMerchantOrders } from '@/lib/db/repositories/orders';
import { OrderStatus } from '@/lib/types/database';
import {
  merchantOrdersQuerySchema,
} from '@/lib/validation/schemas';
import {
  getAuthContext,
  verifyMerchant,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const statusParam = searchParams.get('status');

    // Validate query params
    const parseResult = merchantOrdersQuerySchema.safeParse({
      merchant_id: merchantId,
      status: statusParam || undefined,
    });

    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { merchant_id } = parseResult.data;

    // Authorization: check if requester can access this merchant's orders
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchant_id;
      if (!isOwner && auth.actorType !== 'system') {
        logger.auth.forbidden('GET /api/merchant/orders', auth.actorId, 'Not merchant owner');
        return forbiddenResponse('You can only access your own orders');
      }
    }

    // Verify merchant exists
    const merchantExists = await verifyMerchant(merchant_id);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    const status = statusParam ? statusParam.split(',') as OrderStatus[] : undefined;
    const orders = await getMerchantOrders(merchant_id, status);

    console.log('[API] /api/merchant/orders - merchant_id:', merchant_id, 'orders found:', orders?.length || 0);
    if (orders && orders.length > 0) {
      console.log('[API] Orders:', orders.map(o => ({ id: o.id, status: o.status, merchant_id: o.merchant_id })));
    }

    logger.api.request('GET', '/api/merchant/orders', merchant_id);
    return successResponse(orders || []);
  } catch (error) {
    logger.api.error('GET', '/api/merchant/orders', error as Error);
    return errorResponse('Internal server error');
  }
}
