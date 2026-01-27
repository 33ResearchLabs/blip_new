import { NextRequest, NextResponse } from 'next/server';
import { getMerchantOrders, createOrder, getOrderWithRelations } from '@/lib/db/repositories/orders';
import { getMerchantOffers, getOfferWithMerchant } from '@/lib/db/repositories/merchants';
import { getUserByWallet, createUser } from '@/lib/db/repositories/users';
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
      customer_wallet,
      type,
      crypto_amount,
      payment_method,
      offer_id,
    } = parseResult.data;

    // Verify merchant exists
    const merchantExists = await verifyMerchant(merchant_id);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    // Find or create user by wallet address
    let user = await getUserByWallet(customer_wallet);
    if (!user) {
      // Create a new user with the wallet address
      // Generate a temporary username from wallet address
      const tempUsername = `user_${customer_wallet.slice(0, 8)}`;

      try {
        user = await createUser({
          username: tempUsername,
          wallet_address: customer_wallet,
        });
        logger.info('Created new user for merchant-initiated order', {
          userId: user.id,
          walletAddress: customer_wallet,
        });
      } catch (createError) {
        // User might already exist with this wallet (race condition)
        user = await getUserByWallet(customer_wallet);
        if (!user) {
          logger.error('Failed to create user for merchant order', { error: createError });
          return errorResponse('Failed to create user account');
        }
      }
    }

    // Get merchant's offer
    let offer;
    if (offer_id) {
      // Use specific offer if provided
      offer = await getOfferWithMerchant(offer_id);
      if (!offer || offer.merchant_id !== merchant_id) {
        return validationErrorResponse(['Offer not found or does not belong to this merchant']);
      }
    } else {
      // Find merchant's active offer matching the type and payment method
      const merchantOffers = await getMerchantOffers(merchant_id);
      offer = merchantOffers.find(
        o => o.type === type && o.payment_method === payment_method && o.is_active
      );

      if (!offer) {
        return NextResponse.json(
          { success: false, error: `No active ${type} offer found with ${payment_method} payment method. Please create a corridor first.` },
          { status: 404 }
        );
      }

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
    // Orders are stored from user's perspective, so we invert the type
    const orderType = type === 'sell' ? 'buy' : 'sell';

    // Create the order
    const order = await createOrder({
      user_id: user.id,
      merchant_id,
      offer_id: offer.id,
      type: orderType as OfferType,
      payment_method: offer.payment_method as PaymentMethod,
      crypto_amount,
      fiat_amount: fiatAmount,
      rate: offer.rate,
      payment_details: paymentDetails,
      // For buy orders (user buys), store user's wallet to receive crypto
      buyer_wallet_address: orderType === 'buy' ? customer_wallet : undefined,
    });

    logger.info('Merchant-initiated order created', {
      orderId: order.id,
      merchantId: merchant_id,
      userId: user.id,
      cryptoAmount: crypto_amount,
      orderType,
    });

    // Get full order with relations for response
    const orderWithRelations = await getOrderWithRelations(order.id);

    // Notify via Pusher (notify both user and merchant)
    try {
      await notifyOrderCreated({
        orderId: order.id,
        userId: user.id,
        merchantId: merchant_id,
        status: order.status,
        updatedAt: new Date().toISOString(),
        data: orderWithRelations,
      });
      console.log('[API] Pusher notification sent for merchant-initiated order:', order.id);
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
