import { NextRequest, NextResponse } from 'next/server';
import { createOrder, getUserOrders } from '@/lib/db/repositories/orders';
import { findBestOffer, getOfferWithMerchant } from '@/lib/db/repositories/merchants';
import { OfferType, PaymentMethod } from '@/lib/types/database';
import {
  createOrderSchema,
  userOrdersQuerySchema,
} from '@/lib/validation/schemas';
import {
  getAuthContext,
  verifyUser,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit, STANDARD_LIMIT, ORDER_LIMIT } from '@/lib/middleware/rateLimit';
import { logger } from '@/lib/logger';
import { notifyOrderCreated } from '@/lib/pusher/server';

export async function GET(request: NextRequest) {
  // Rate limit: 100 requests per minute
  const rateLimitResponse = checkRateLimit(request, 'orders:get', STANDARD_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('user_id');

    // Validate query params
    const parseResult = userOrdersQuerySchema.safeParse({
      user_id: userId,
      status: searchParams.get('status') || undefined,
    });

    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { user_id } = parseResult.data;

    // Authorization: check if requester can access this user's orders
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'user' && auth.actorId === user_id;
      if (!isOwner && auth.actorType !== 'system') {
        logger.auth.forbidden('GET /api/orders', auth.actorId, 'Not order owner');
        return forbiddenResponse('You can only access your own orders');
      }
    }

    const orders = await getUserOrders(user_id);
    logger.api.request('GET', '/api/orders', user_id);
    return successResponse(orders || []);
  } catch (error) {
    logger.api.error('GET', '/api/orders', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function POST(request: NextRequest) {
  // Rate limit: 20 orders per minute
  const rateLimitResponse = checkRateLimit(request, 'orders:create', ORDER_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();

    // Validate request body
    const parseResult = createOrderSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const {
      user_id,
      offer_id,
      crypto_amount,
      type,
      payment_method,
      preference,
      user_bank_account,
      buyer_wallet_address,
    } = parseResult.data;

    // Authorization: verify the user exists and is making a request for themselves
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'user' && auth.actorId === user_id;
      if (!isOwner && auth.actorType !== 'system') {
        logger.auth.forbidden('POST /api/orders', auth.actorId, 'Creating order for different user');
        return forbiddenResponse('You can only create orders for yourself');
      }
    }

    // Verify user exists
    const userExists = await verifyUser(user_id);
    if (!userExists) {
      return validationErrorResponse(['User not found']);
    }

    let offer;

    // If offer_id provided, use that offer
    if (offer_id) {
      offer = await getOfferWithMerchant(offer_id);
      if (!offer) {
        return NextResponse.json(
          { success: false, error: 'Offer not found' },
          { status: 404 }
        );
      }

      // Check if offer has enough liquidity
      if (offer.available_amount < crypto_amount) {
        return validationErrorResponse([
          `Insufficient liquidity. Available: ${offer.available_amount}, Requested: ${crypto_amount}`,
        ]);
      }

      // Check amount bounds
      if (crypto_amount < offer.min_amount || crypto_amount > offer.max_amount) {
        return validationErrorResponse([
          `Amount must be between ${offer.min_amount} and ${offer.max_amount}`,
        ]);
      }
    } else {
      // Find best matching offer
      // When user wants to buy crypto, we need a merchant sell offer (and vice versa)
      const offerType = type === 'buy' ? 'sell' : 'buy';
      offer = await findBestOffer(
        crypto_amount,
        offerType as OfferType,
        (payment_method as PaymentMethod) || 'bank',
        preference || 'best'
      );

      if (!offer) {
        return NextResponse.json(
          { success: false, error: 'No matching offers available' },
          { status: 404 }
        );
      }
    }

    // Calculate fiat amount
    const fiatAmount = crypto_amount * offer.rate;

    // Build payment details snapshot
    // For sell orders, include user's bank account where merchant will send fiat
    const paymentDetails =
      offer.payment_method === 'bank'
        ? {
            bank_name: offer.bank_name,
            bank_account_name: offer.bank_account_name,
            bank_iban: offer.bank_iban,
            // User's bank for sell orders (where merchant sends fiat)
            user_bank_account: type === 'sell' ? user_bank_account : undefined,
          }
        : {
            location_name: offer.location_name,
            location_address: offer.location_address,
            location_lat: offer.location_lat,
            location_lng: offer.location_lng,
            meeting_instructions: offer.meeting_instructions,
            user_bank_account: type === 'sell' ? user_bank_account : undefined,
          };

    // Create the order
    const order = await createOrder({
      user_id,
      merchant_id: offer.merchant_id,
      offer_id: offer.id,
      type: type as OfferType,
      payment_method: offer.payment_method,
      crypto_amount,
      fiat_amount: fiatAmount,
      rate: offer.rate,
      payment_details: paymentDetails,
      buyer_wallet_address: type === 'buy' ? buyer_wallet_address : undefined, // Store buyer's wallet for buy orders
    });

    console.log('[API] Order created - orderId:', order.id, 'merchantId:', offer.merchant_id, 'merchantName:', offer.merchant?.display_name, 'offerId:', offer.id);

    logger.info('Order created successfully', {
      orderId: order.id,
      orderStatus: order.status,
      userId: user_id,
      merchantId: offer.merchant_id,
      merchantName: offer.merchant?.display_name,
      offerId: offer.id,
      cryptoAmount: crypto_amount,
    });

    logger.order.created(order.id, user_id, offer.merchant_id, crypto_amount);

    // Notify merchant of new order via Pusher
    try {
      await notifyOrderCreated({
        orderId: order.id,
        userId: user_id,
        merchantId: offer.merchant_id,
        status: order.status,
        updatedAt: new Date().toISOString(),
        data: { ...order, offer, merchant: offer.merchant },
      });
      console.log('[API] Pusher notification sent successfully for order:', order.id);
    } catch (pusherError) {
      console.error('[API] Failed to send Pusher notification:', pusherError);
    }

    return NextResponse.json(
      { success: true, data: { ...order, offer, merchant: offer.merchant } },
      { status: 201 }
    );
  } catch (error) {
    const err = error as Error;
    console.error('[API] POST /api/orders error:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
    logger.api.error('POST', '/api/orders', err);

    // Return specific error to help debug
    return errorResponse(`${err.name}: ${err.message}`);
  }
}
