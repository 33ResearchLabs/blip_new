import { NextRequest } from 'next/server';
import { searchUsersAndMerchants } from '@/lib/db/repositories/directMessages';
import {
  getAuthContext,
  verifyMerchant,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';

// GET /api/merchant/contacts/search?q=username&merchant_id=xxx
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const q = searchParams.get('q');

    if (!merchantId) {
      return validationErrorResponse(['merchant_id is required']);
    }

    if (!q || q.trim().length < 2) {
      return validationErrorResponse(['Search query must be at least 2 characters']);
    }

    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchantId;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only search from your own account');
      }
    }

    const merchantExists = await verifyMerchant(merchantId);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    const results = await searchUsersAndMerchants(q.trim(), merchantId);
    return successResponse(results);
  } catch (error) {
    console.error('Error searching contacts:', error);
    return errorResponse('Internal server error');
  }
}
