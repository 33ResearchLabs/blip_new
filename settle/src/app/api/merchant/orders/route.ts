import { NextRequest, NextResponse } from 'next/server';
import { getMerchantOrders, getAllPendingOrdersForMerchant } from '@/lib/db/repositories/orders';
import { getMerchantOffers, getOfferWithMerchant } from '@/lib/db/repositories/merchants';
import { createUser } from '@/lib/db/repositories/users';
import {
  OfferType,
  PaymentMethod,
  logger,
  normalizeStatus,
} from 'settlement-core';
import {
  merchantOrdersQuerySchema,
  merchantCreateOrderSchema,
} from '@/lib/validation/schemas';
import {
  getAuthContext,
  verifyMerchant,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { proxyCoreApi } from '@/lib/proxy/coreApi';

// Prevent Next.js from caching this route - orders must always be fresh
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const statusParam = searchParams.get('status');
    const includeAllPending = searchParams.get('include_all_pending') === 'true';

    // Validate query params
    const parseResult = merchantOrdersQuerySchema.safeParse({
      merchant_id: merchantId,
      status: statusParam || undefined,
    });

    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      console.error('[API] /api/merchant/orders validation failed:', errors, 'merchantId:', merchantId);
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

    // Verify merchant exists and is active
    const merchantExists = await verifyMerchant(merchant_id);
    if (!merchantExists) {
      console.error('[API] GET /api/merchant/orders - Merchant not found or not active:', merchant_id);
      return validationErrorResponse(['Merchant not found or not active']);
    }

    const status = statusParam ? statusParam.split(',') as string[] : undefined;

    // If include_all_pending is true, fetch ALL pending orders (broadcast model)
    // Otherwise, fetch only orders for this specific merchant
    let orders;
    if (includeAllPending) {
      // Get merchant's own orders + ALL pending orders from any merchant
      orders = await getAllPendingOrdersForMerchant(merchant_id, status as any);
      console.log('[API] /api/merchant/orders (broadcast mode) - all pending orders:', orders?.length || 0);
    } else {
      orders = await getMerchantOrders(merchant_id, status as any);
      console.log('[API] /api/merchant/orders - merchant_id:', merchant_id, 'orders found:', orders?.length || 0);
    }

    if (orders && orders.length > 0) {
      console.log('[API] Orders:', orders.map(o => ({ id: o.id, status: o.status, merchant_id: o.merchant_id })));
    }

    // Add minimal_status to each order
    const ordersWithMinimalStatus = (orders || []).map(order => ({
      ...order,
      minimal_status: normalizeStatus(order.status),
    }));

    logger.api.request('GET', '/api/merchant/orders', merchant_id);
    return successResponse(ordersWithMinimalStatus);
  } catch (error) {
    logger.api.error('GET', '/api/merchant/orders', error as Error);
    return errorResponse('Internal server error');
  }
}

// Merchant-initiated order creation
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body
    const parseResult = merchantCreateOrderSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const {
      merchant_id,
      type,
      crypto_amount,
      payment_method,
      spread_preference,
      offer_id,
      target_merchant_id,
      escrow_tx_hash,
      escrow_trade_id,
      escrow_trade_pda,
      escrow_pda,
      escrow_creator_wallet,
    } = parseResult.data;

    // Verify the creating merchant exists
    const merchantExists = await verifyMerchant(merchant_id);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    // M2M Trading: If target_merchant_id is provided, trade with another merchant
    const isM2MTrade = !!target_merchant_id && target_merchant_id !== merchant_id;

    if (isM2MTrade) {
      // Verify target merchant exists
      const targetMerchantExists = await verifyMerchant(target_merchant_id);
      if (!targetMerchantExists) {
        return validationErrorResponse(['Target merchant not found or not active']);
      }
    }

    // Create a placeholder user for merchant-initiated orders
    // This allows merchants to create orders that any customer can accept later
    let user;
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const placeholderUsername = isM2MTrade
      ? `m2m_${merchant_id.slice(0, 8)}_${Date.now()}_${randomSuffix}`
      : `open_order_${Date.now()}_${randomSuffix}`;
    // Retry up to 3 times if username conflicts occur
    let createAttempts = 0;
    const maxAttempts = 3;
    while (createAttempts < maxAttempts) {
      try {
        const attemptSuffix = createAttempts > 0 ? `_r${createAttempts}` : '';
        user = await createUser({
          username: placeholderUsername + attemptSuffix,
          name: isM2MTrade ? 'M2M Trade' : 'Open Order',
        });
        logger.info('Created placeholder user for merchant order', {
          userId: user.id,
          isM2MTrade,
          attempts: createAttempts + 1,
        });
        break;
      } catch (createError: any) {
        createAttempts++;
        const isUniqueViolation = createError?.message?.includes('duplicate') ||
                                 createError?.message?.includes('unique') ||
                                 createError?.code === '23505';

        if (isUniqueViolation && createAttempts < maxAttempts) {
          logger.warn('Username conflict, retrying...', { attempt: createAttempts });
          continue;
        }

        logger.error('Failed to create placeholder user', {
          error: createError,
          message: createError?.message,
          code: createError?.code,
          attempts: createAttempts,
        });
        return errorResponse(`Failed to create order: ${createError?.message || 'Unknown error'}`);
      }
    }

    if (!user) {
      return errorResponse('Failed to create order after multiple attempts');
    }

    // Determine which merchant's offer to use
    const offerMerchantId = isM2MTrade ? target_merchant_id : merchant_id;

    // Get merchant's offer
    let offer;
    if (offer_id) {
      // Use specific offer if provided
      offer = await getOfferWithMerchant(offer_id);
      if (!offer || offer.merchant_id !== offerMerchantId) {
        return validationErrorResponse([`Offer not found or does not belong to ${isM2MTrade ? 'target' : 'this'} merchant`]);
      }
    } else {
      // Find merchant's active offer matching the type and payment method
      const offerTypeToFind = isM2MTrade ? type : type;
      const merchantOffers = await getMerchantOffers(offerMerchantId);
      console.log('[API] Looking for offer type:', offerTypeToFind, 'payment_method:', payment_method);
      console.log('[API] Merchant offers found:', merchantOffers.map(o => ({ id: o.id, type: o.type, payment_method: o.payment_method, is_active: o.is_active })));

      offer = merchantOffers.find(
        o => o.type === offerTypeToFind && o.payment_method === payment_method && o.is_active
      );

      if (!offer) {
        // For merchant-initiated orders with escrow already locked (SELL orders from balance widget),
        // try to find ANY active offer from this merchant as a fallback
        if (escrow_tx_hash && merchantOffers.length > 0) {
          console.log('[API] No exact match, using first active offer as fallback for escrowed order');
          offer = merchantOffers.find(o => o.is_active) || merchantOffers[0];
          if (offer) {
            offer = await getOfferWithMerchant(offer.id);
          }
        }

        if (!offer) {
          console.error('[API] No matching offer found for merchant:', offerMerchantId);
          return NextResponse.json(
            { success: false, error: `No active ${offerTypeToFind} offer found with ${payment_method} payment method${isM2MTrade ? ' from target merchant' : ''}. ${isM2MTrade ? 'The target merchant needs to create a corridor first.' : 'Please create a corridor first.'}` },
            { status: 404 }
          );
        }
      } else {
        console.log('[API] Found matching offer:', offer.id);
        // Get full offer with merchant data
        offer = await getOfferWithMerchant(offer.id);
      }
    }

    if (!offer) {
      return NextResponse.json(
        { success: false, error: 'No matching offer found' },
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

    // Calculate fiat amount
    const fiatAmount = crypto_amount * offer.rate;

    // Calculate protocol fee based on spread preference
    const protocolFeePercentage = spread_preference === 'best' ? 2.00
      : spread_preference === 'fastest' ? 2.50
      : 1.50; // cheap
    const protocolFeeAmount = crypto_amount * (protocolFeePercentage / 100);

    logger.info('Order pricing calculated', {
      crypto_amount,
      fiat_amount: fiatAmount,
      spread_preference,
      protocol_fee_percentage: protocolFeePercentage,
      protocol_fee_amount: protocolFeeAmount,
    });

    // Build payment details snapshot
    const paymentDetails =
      offer.payment_method === 'bank'
        ? {
            bank_name: offer.bank_name,
            bank_account_name: offer.bank_account_name,
            bank_iban: offer.bank_iban,
          }
        : {
            location_name: offer.location_name,
            location_address: offer.location_address,
            location_lat: offer.location_lat,
            location_lng: offer.location_lng,
            meeting_instructions: offer.meeting_instructions,
          };

    // For merchant-initiated orders, the type from merchant's perspective:
    // - 'sell' = merchant sells USDC to user (user buys USDC) -> order type is 'buy' (from user perspective)
    // - 'buy' = merchant buys USDC from user (user sells USDC) -> order type is 'sell' (from user perspective)
    // Orders are stored from user's perspective, so we invert the type
    const orderType = type === 'sell' ? 'buy' : 'sell';

    // For M2M trades:
    // - merchant_id = target merchant (the one fulfilling the order)
    // - buyer_merchant_id = creating merchant (the one placing the order)
    const orderMerchantId = isM2MTrade ? target_merchant_id : merchant_id;
    const buyerMerchantId = (isM2MTrade || type === 'buy') ? merchant_id : undefined;

    // Forward to core-api (single writer for all mutations)
    return proxyCoreApi('/v1/merchant/orders', {
      method: 'POST',
      body: {
        merchant_id,
        user_id: user.id,
        offer_id: offer.id,
        type: orderType,
        payment_method: offer.payment_method,
        crypto_amount,
        fiat_amount: fiatAmount,
        rate: offer.rate,
        payment_details: paymentDetails,
        spread_preference,
        protocol_fee_percentage: protocolFeePercentage,
        protocol_fee_amount: protocolFeeAmount,
        buyer_merchant_id: buyerMerchantId,
        escrow_tx_hash,
        escrow_trade_id,
        escrow_trade_pda,
        escrow_pda,
        escrow_creator_wallet,
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.api.error('POST', '/api/merchant/orders', err);
    console.error('[API] Error creating merchant order:', {
      name: err.name,
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 5).join('\n'),
    });
    // Return specific error to help debug
    return errorResponse(`${err.name}: ${err.message}`);
  }
}
