import { NextRequest } from 'next/server';
import {
  upsertMerchantQuote,
  getMerchantQuote,
} from '@/lib/db/repositories/mempool';
import {
  getAuthContext,
  validationErrorResponse,
  successResponse,
  errorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';

// GET /api/merchant-quotes - Get merchant quote
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const corridorId = searchParams.get('corridor_id') || 'USDT_AED';

    if (!merchantId) {
      return validationErrorResponse(['merchant_id is required']);
    }

    const quote = await getMerchantQuote(merchantId, corridorId);
    return successResponse({ quote });
  } catch (error) {
    console.error('Error fetching merchant quote:', error);
    return errorResponse('Internal server error');
  }
}

// POST /api/merchant-quotes - Create or update merchant quote
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      merchant_id,
      corridor_id = 'USDT_AED',
      min_price_aed_per_usdt,
      min_size_usdt = 10,
      max_size_usdt = 10000,
      sla_minutes = 15,
      available_liquidity_usdt,
      is_online = true,
    } = body;

    if (!merchant_id || !min_price_aed_per_usdt || available_liquidity_usdt === undefined) {
      return validationErrorResponse([
        'merchant_id, min_price_aed_per_usdt, and available_liquidity_usdt are required',
      ]);
    }

    // Authorization check
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchant_id;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only manage your own quotes');
      }
    }

    // Validate values
    if (min_price_aed_per_usdt <= 0) {
      return validationErrorResponse(['min_price_aed_per_usdt must be positive']);
    }

    if (min_size_usdt <= 0 || max_size_usdt <= 0) {
      return validationErrorResponse(['min_size_usdt and max_size_usdt must be positive']);
    }

    if (min_size_usdt > max_size_usdt) {
      return validationErrorResponse(['min_size_usdt cannot exceed max_size_usdt']);
    }

    if (available_liquidity_usdt < 0) {
      return validationErrorResponse(['available_liquidity_usdt cannot be negative']);
    }

    if (sla_minutes <= 0) {
      return validationErrorResponse(['sla_minutes must be positive']);
    }

    const quote = await upsertMerchantQuote({
      merchant_id,
      corridor_id,
      min_price_aed_per_usdt,
      min_size_usdt,
      max_size_usdt,
      sla_minutes,
      available_liquidity_usdt,
      is_online,
    });

    return successResponse(quote, quote ? 200 : 201);
  } catch (error) {
    console.error('Error upserting merchant quote:', error);
    return errorResponse('Internal server error');
  }
}
