import { NextRequest, NextResponse } from 'next/server';
import { getMerchantOrders, createOrder, getOrderWithRelations, getAllPendingOrdersForMerchant, sendMessage } from '@/lib/db/repositories/orders';
import { getMerchantOffers, getOfferWithMerchant } from '@/lib/db/repositories/merchants';
import { createUser } from '@/lib/db/repositories/users';
import { OrderStatus, OfferType, PaymentMethod } from '@/lib/types/database';
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
import { logger } from '@/lib/logger';
import { notifyOrderCreated } from '@/lib/pusher/server';

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

    const status = statusParam ? statusParam.split(',') as OrderStatus[] : undefined;

    // If include_all_pending is true, fetch ALL pending orders (broadcast model)
    // Otherwise, fetch only orders for this specific merchant
    let orders;
    if (includeAllPending) {
      // Get merchant's own orders + ALL pending orders from any merchant
      orders = await getAllPendingOrdersForMerchant(merchant_id, status);
      console.log('[API] /api/merchant/orders (broadcast mode) - all pending orders:', orders?.length || 0);
    } else {
      orders = await getMerchantOrders(merchant_id, status);
      console.log('[API] /api/merchant/orders - merchant_id:', merchant_id, 'orders found:', orders?.length || 0);
    }

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
      offer_id,
      target_merchant_id,
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
    const placeholderUsername = isM2MTrade
      ? `m2m_${merchant_id.slice(0, 8)}_${Date.now()}`
      : `open_order_${Date.now()}`;
    try {
      user = await createUser({
        username: placeholderUsername,
        name: isM2MTrade ? 'M2M Trade' : 'Open Order',
      });
      logger.info('Created placeholder user for merchant order', {
        userId: user.id,
        isM2MTrade,
      });
    } catch (createError) {
      logger.error('Failed to create placeholder user', { error: createError });
      return errorResponse('Failed to create order');
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
      // For M2M trades: look for the OPPOSITE type (if buyer wants to buy, seller must have sell offer)
      const offerTypeToFind = isM2MTrade
        ? type // For M2M: the type stays as-is (buy = I want to buy from their sell offer)
        : type;
      const merchantOffers = await getMerchantOffers(offerMerchantId);
      console.log('[API] Looking for offer type:', offerTypeToFind, 'payment_method:', payment_method);
      console.log('[API] Merchant offers found:', merchantOffers.map(o => ({ id: o.id, type: o.type, payment_method: o.payment_method, is_active: o.is_active })));

      offer = merchantOffers.find(
        o => o.type === offerTypeToFind && o.payment_method === payment_method && o.is_active
      );

      if (!offer) {
        console.error('[API] No matching offer found for merchant:', offerMerchantId);
        return NextResponse.json(
          { success: false, error: `No active ${offerTypeToFind} offer found with ${payment_method} payment method${isM2MTrade ? ' from target merchant' : ''}. ${isM2MTrade ? 'The target merchant needs to create a corridor first.' : 'Please create a corridor first.'}` },
          { status: 404 }
        );
      }

      console.log('[API] Found matching offer:', offer.id);
      // Get full offer with merchant data
      offer = await getOfferWithMerchant(offer.id);
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
    // - 'sell' = merchant sells USDC to user (user buys USDC) → order type is 'buy' (from user perspective)
    // - 'buy' = merchant buys USDC from user (user sells USDC) → order type is 'sell' (from user perspective)
    // For M2M trades, the type is from the creating merchant's perspective
    // Orders are stored from user's perspective, so we invert the type
    const orderType = type === 'sell' ? 'buy' : 'sell';

    // For M2M trades:
    // - merchant_id = target merchant (the one fulfilling the order)
    // - buyer_merchant_id = creating merchant (the one placing the order)
    const orderMerchantId = isM2MTrade ? target_merchant_id : merchant_id;
    const buyerMerchantId = isM2MTrade ? merchant_id : undefined;

    // Create the order
    const order = await createOrder({
      user_id: user.id,
      merchant_id: orderMerchantId,
      offer_id: offer.id,
      type: orderType as OfferType,
      payment_method: offer.payment_method as PaymentMethod,
      crypto_amount,
      fiat_amount: fiatAmount,
      rate: offer.rate,
      payment_details: paymentDetails,
      buyer_merchant_id: buyerMerchantId,
    });

    logger.info('Merchant-initiated order created', {
      orderId: order.id,
      merchantId: orderMerchantId,
      buyerMerchantId: buyerMerchantId || null,
      userId: user.id,
      cryptoAmount: crypto_amount,
      orderType,
      isM2MTrade,
    });

    // Send auto welcome messages for the chat
    try {
      await sendMessage({
        order_id: order.id,
        sender_type: 'system',
        sender_id: order.id,
        content: `Order #${order.order_number} created for ${crypto_amount} USDC`,
        message_type: 'system',
      });
      await sendMessage({
        order_id: order.id,
        sender_type: 'system',
        sender_id: order.id,
        content: `Rate: ${offer.rate} AED/USDC • Total: ${fiatAmount.toFixed(2)} AED`,
        message_type: 'system',
      });
      await sendMessage({
        order_id: order.id,
        sender_type: 'system',
        sender_id: order.id,
        content: `⏱ This order expires in 15 minutes`,
        message_type: 'system',
      });
    } catch (msgError) {
      console.error('[API] Failed to send auto messages:', msgError);
    }

    // Get full order with relations for response
    const orderWithRelations = await getOrderWithRelations(order.id);

    // Notify via Pusher (notify both user and merchant)
    // For M2M trades, notify both the target merchant and the buyer merchant
    try {
      await notifyOrderCreated({
        orderId: order.id,
        userId: user.id,
        merchantId: orderMerchantId,
        status: order.status,
        updatedAt: new Date().toISOString(),
        data: orderWithRelations,
      });
      console.log('[API] Pusher notification sent for merchant-initiated order:', order.id);

      // For M2M trades, also notify the buyer merchant
      if (isM2MTrade && buyerMerchantId) {
        await notifyOrderCreated({
          orderId: order.id,
          userId: user.id,
          merchantId: buyerMerchantId,
          status: order.status,
          updatedAt: new Date().toISOString(),
          data: orderWithRelations,
        });
        console.log('[API] Pusher notification sent to buyer merchant:', buyerMerchantId);
      }
    } catch (pusherError) {
      console.error('[API] Failed to send Pusher notification:', pusherError);
    }

    return NextResponse.json(
      { success: true, data: orderWithRelations },
      { status: 201 }
    );
  } catch (error) {
    logger.api.error('POST', '/api/merchant/orders', error as Error);
    console.error('[API] Error creating merchant order:', error);
    return errorResponse('Internal server error');
  }
}
