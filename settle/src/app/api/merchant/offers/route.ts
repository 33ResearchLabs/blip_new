import { NextRequest } from 'next/server';
import { getMerchantOffers, createOffer } from '@/lib/db/repositories/merchants';
import {
  createOfferSchema,
  uuidSchema,
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

    // Validate merchant_id
    if (!merchantId) {
      return validationErrorResponse(['merchant_id is required']);
    }

    const idValidation = uuidSchema.safeParse(merchantId);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid merchant_id format']);
    }

    // Authorization: check if requester can access this merchant's offers
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchantId;
      // Allow users to view offers (they need to see them for ordering)
      const isUser = auth.actorType === 'user';
      if (!isOwner && !isUser && auth.actorType !== 'system') {
        logger.auth.forbidden('GET /api/merchant/offers', auth.actorId, 'Access denied');
        return forbiddenResponse('Access denied');
      }
    }

    const offers = await getMerchantOffers(merchantId);
    logger.api.request('GET', '/api/merchant/offers', auth?.actorId);
    return successResponse(offers);
  } catch (error) {
    logger.api.error('GET', '/api/merchant/offers', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body
    const parseResult = createOfferSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const {
      merchant_id,
      type,
      payment_method,
      rate,
      min_amount,
      max_amount,
      available_amount,
      bank_name,
      bank_account_name,
      bank_iban,
      location_name,
      location_address,
      location_lat,
      location_lng,
      meeting_instructions,
    } = parseResult.data;

    // Authorization: only the merchant can create their own offers
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchant_id;
      if (!isOwner && auth.actorType !== 'system') {
        logger.auth.forbidden('POST /api/merchant/offers', auth.actorId, 'Creating offer for different merchant');
        return forbiddenResponse('You can only create offers for yourself');
      }
    }

    // Verify merchant exists
    const merchantExists = await verifyMerchant(merchant_id);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    const offer = await createOffer({
      merchant_id,
      type,
      payment_method,
      rate,
      min_amount,
      max_amount,
      available_amount,
      bank_name,
      bank_account_name,
      bank_iban,
      location_name,
      location_address,
      location_lat,
      location_lng,
      meeting_instructions,
    });

    logger.info('Offer created', {
      offerId: offer.id,
      merchantId: merchant_id,
      type,
      paymentMethod: payment_method,
    });

    return successResponse(offer, 201);
  } catch (error) {
    logger.api.error('POST', '/api/merchant/offers', error as Error);
    return errorResponse('Internal server error');
  }
}
