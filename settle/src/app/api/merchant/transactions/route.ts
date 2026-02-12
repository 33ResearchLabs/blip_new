import { NextRequest, NextResponse } from 'next/server';
import { getMerchantTransactions, getOrderTransactions, getMerchantBalanceSummary } from '@/lib/db/repositories/transactions';
import { getAuthContext, verifyMerchant, forbiddenResponse, validationErrorResponse, successResponse, errorResponse } from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const orderId = searchParams.get('order_id');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const summary = searchParams.get('summary') === 'true';

    // Authorization
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchantId;
      if (!isOwner && auth.actorType !== 'system') {
        logger.auth.forbidden('GET /api/merchant/transactions', auth.actorId, 'Not merchant owner');
        return forbiddenResponse('You can only access your own transactions');
      }
    }

    // Get balance summary
    if (summary && merchantId) {
      const summaryData = await getMerchantBalanceSummary(merchantId);
      return successResponse(summaryData);
    }

    // Get order transactions
    if (orderId) {
      const transactions = await getOrderTransactions(orderId);
      return successResponse(transactions);
    }

    // Get merchant transactions
    if (merchantId) {
      const merchantExists = await verifyMerchant(merchantId);
      if (!merchantExists) {
        return validationErrorResponse(['Merchant not found or not active']);
      }

      const transactions = await getMerchantTransactions(merchantId, limit, offset);
      return successResponse(transactions);
    }

    return validationErrorResponse(['merchant_id or order_id required']);
  } catch (error) {
    logger.api.error('GET', '/api/merchant/transactions', error as Error);
    return errorResponse('Internal server error');
  }
}
