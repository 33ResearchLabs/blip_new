import { NextRequest, NextResponse } from 'next/server';
import { getActiveOffers, findBestOffer } from '@/lib/db/repositories/merchants';
import { OfferType, PaymentMethod } from '@/lib/types/database';
import { offerFiltersSchema } from '@/lib/validation/schemas';
import {
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Validate query params
    const parseResult = offerFiltersSchema.safeParse({
      type: searchParams.get('type') || undefined,
      payment_method: searchParams.get('payment_method') || undefined,
      amount: searchParams.get('amount') || undefined,
      preference: searchParams.get('preference') || undefined,
    });

    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { type, payment_method, amount, preference } = parseResult.data;

    // If looking for best single offer
    if (amount && type && payment_method) {
      const offer = await findBestOffer(
        amount,
        type as OfferType,
        payment_method as PaymentMethod,
        preference || 'best'
      );

      if (!offer) {
        logger.warn('No matching offers found', { type, payment_method, amount, preference });
        return NextResponse.json(
          { success: false, error: 'No matching offers found' },
          { status: 404 }
        );
      }

      logger.info('Best offer found', {
        offerId: offer.id,
        merchantId: offer.merchant_id,
        merchantName: offer.merchant?.display_name,
        rate: offer.rate,
      });

      logger.api.request('GET', '/api/offers (best match)');
      return successResponse(offer);
    }

    // Otherwise return all matching offers
    const offers = await getActiveOffers({
      type: type || undefined,
      payment_method: payment_method || undefined,
      min_amount: amount || undefined,
    });

    logger.api.request('GET', '/api/offers');
    return successResponse(offers);
  } catch (error) {
    logger.api.error('GET', '/api/offers', error as Error);
    return errorResponse('Internal server error');
  }
}
