import { NextRequest, NextResponse } from 'next/server';
import { getUserOrders } from '@/lib/db/repositories/orders';
import { findBestOffer, getOfferWithMerchant } from '@/lib/db/repositories/merchants';
import { verifyPaymentMethodOwnership } from '@/lib/db/repositories/paymentMethods';
import { getMerchantDefaultPaymentMethod } from '@/lib/db/repositories/merchantPaymentMethods';
import { OfferType, PaymentMethod, logger, normalizeStatus } from 'settlement-core';
import {
  createOrderSchema,
  userOrdersQuerySchema,
} from '@/lib/validation/schemas';
import {
  requireAuth,
  verifyUser,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit, STANDARD_LIMIT, ORDER_LIMIT } from '@/lib/middleware/rateLimit';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import { transaction, query as dbQuery } from '@/lib/db';
import { enrichOrderResponse } from '@/lib/orders/enrichOrderResponse';
import { auditLog } from '@/lib/auditLog';
import { getIdempotencyKey, withIdempotency } from '@/lib/idempotency';
import { createHash } from 'crypto';
import { guardOrderCreation } from '@/lib/guards';

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Rate limit: 100 requests per minute
  const rateLimitResponse = await checkRateLimit(request, 'orders:get', STANDARD_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('user_id');

    // Validate query params
    const parseResult = userOrdersQuerySchema.safeParse({
      user_id: userId,
      status: searchParams.get('status') || undefined,
      days: searchParams.get('days') || undefined,
    });

    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { user_id, status, days } = parseResult.data;

    // Authorization: require authenticated user
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === user_id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden('GET /api/orders', auth.actorId, 'Not order owner');
      return forbiddenResponse('You can only access your own orders');
    }

    // Parse status filter (comma-separated)
    const statusFilter = status ? status.split(',').filter(Boolean) as any[] : undefined;

    const orders = await getUserOrders(user_id, statusFilter, days);

    // Enrich each order with backend-driven UI fields
    const enrichedOrders = (orders || []).map(order => ({
      ...order,
      minimal_status: normalizeStatus(order.status),
      ...enrichOrderResponse(order, user_id),
    }));

    logger.api.request('GET', '/api/orders', user_id);
    return successResponse(enrichedOrders);
  } catch (error) {
    logger.api.error('GET', '/api/orders', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function POST(request: NextRequest) {
  // Rate limit: 20 orders per minute
  const rateLimitResponse = await checkRateLimit(request, 'orders:create', ORDER_LIMIT);
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
      payment_method_id,
      escrow_trade_id,
      escrow_trade_pda,
      escrow_pda,
      escrow_creator_wallet,
      escrow_tx_hash,
    } = parseResult.data;

    // Authorization: require authenticated user creating order for themselves
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === user_id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden('POST /api/orders', auth.actorId, 'Creating order for different user');
      return forbiddenResponse('You can only create orders for yourself');
    }

    // Verify user exists
    const userExists = await verifyUser(user_id);
    if (!userExists) {
      return validationErrorResponse(['User not found']);
    }

    // Detection guard: log warning if user is creating orders too fast
    guardOrderCreation(user_id, type, crypto_amount);

    // Idempotency: prevent duplicate order creation (double-click, network retry)
    // Use explicit header if provided, otherwise auto-generate from order params + 30s window
    const explicitKey = getIdempotencyKey(request);
    const timeWindow = Math.floor(Date.now() / 30000); // 30-second buckets
    const autoKey = createHash('sha256')
      .update(`create_order:${user_id}:${type}:${crypto_amount}:${payment_method || 'bank'}:${timeWindow}`)
      .digest('hex');
    const idempotencyKey = explicitKey || autoKey;

    // Buy orders require buyer_wallet_address so merchant can release escrow
    if (type === 'buy' && !buyer_wallet_address) {
      return validationErrorResponse(['buyer_wallet_address is required for buy orders. Please connect your wallet.']);
    }

    // Sell orders (user receives fiat): validate payment_method_id if provided
    let verifiedPaymentMethodId: string | undefined;
    if (payment_method_id) {
      const pm = await verifyPaymentMethodOwnership(payment_method_id, user_id);
      if (!pm) {
        return validationErrorResponse(['Invalid or inactive payment method']);
      }
      verifiedPaymentMethodId = pm.id;
    }

    // ── SELL ORDERS: manual merchant-claim model (no offer matching) ────
    // Sell orders are broadcast to all merchants. No merchant_id assigned.
    // A merchant must manually claim via POST /api/orders/:id/claim.
    if (type === 'sell') {
      if (!escrow_tx_hash) {
        return validationErrorResponse([
          'SELL orders require escrow to be locked at creation. Provide escrow_tx_hash and related fields.',
        ]);
      }

      // Get corridor rate for fiat calculation — reject if unavailable
      let sellRate: number | null = null;
      try {
        const corridorRows = await dbQuery<{ ref_price: string }>(
          'SELECT ref_price FROM corridor_prices WHERE corridor_id = $1',
          ['USDT_AED']
        );
        if (corridorRows[0]) {
          sellRate = parseFloat(corridorRows[0].ref_price);
        }
      } catch { /* sellRate stays null */ }
      if (!sellRate || sellRate <= 0) {
        return errorResponse('Exchange rate temporarily unavailable. Please try again in a moment.');
      }

      const fiatAmount = crypto_amount * sellRate;

      // Build user bank details for payment
      let parsedUserBank: Record<string, string> | string | undefined;
      if (user_bank_account) {
        try {
          const parsed = JSON.parse(user_bank_account);
          parsedUserBank = (parsed && typeof parsed === 'object' && parsed.bank_name) ? parsed : user_bank_account;
        } catch { parsedUserBank = user_bank_account; }
      }

      const idempResult = await withIdempotency(
        idempotencyKey,
        'create_order',
        null,
        async () => {
          const resp = await proxyCoreApi('/v1/orders', {
            method: 'POST',
            body: {
              user_id,
              merchant_id: null,
              offer_id: null,
              type: 'sell',
              payment_method: payment_method || 'bank',
              crypto_amount,
              fiat_amount: fiatAmount,
              rate: sellRate,
              payment_details: { user_bank_account: parsedUserBank },
              accepted_at: null,
              ref_price_at_create: sellRate,
              payment_method_id: verifiedPaymentMethodId,
              escrow_tx_hash,
              escrow_trade_id,
              escrow_trade_pda,
              escrow_pda,
              escrow_creator_wallet,
            },
          });
          const data = await resp.json();
          return { data, statusCode: resp.status };
        }
      );

      if (idempResult.cached) {
        logger.info('[Orders] Returning cached sell order (idempotency)', { userId: user_id });
      }
      return NextResponse.json(idempResult.data, { status: idempResult.statusCode });
    }

    // ── BUY ORDERS: manual merchant-claim model (no offer matching) ────
    // Same as sell orders — broadcast to all merchants, first to claim wins.
    // Offer-based flow commented out below for easy revert.

    // Get corridor rate for fiat calculation — reject if unavailable
    let buyRate: number | null = null;
    try {
      const corridorRows = await dbQuery<{ ref_price: string }>(
        'SELECT ref_price FROM corridor_prices WHERE corridor_id = $1',
        ['USDT_AED']
      );
      if (corridorRows[0]) {
        buyRate = parseFloat(corridorRows[0].ref_price);
      }
    } catch { /* buyRate stays null */ }
    if (!buyRate || buyRate <= 0) {
      return errorResponse('Exchange rate temporarily unavailable. Please try again in a moment.');
    }

    const fiatAmount = crypto_amount * buyRate;

    const idempResult = await withIdempotency(
      idempotencyKey,
      'create_order',
      null,
      async () => {
        const resp = await proxyCoreApi('/v1/orders', {
          method: 'POST',
          body: {
            user_id,
            merchant_id: null,
            offer_id: null,
            type: 'buy',
            payment_method: payment_method || 'bank',
            crypto_amount,
            fiat_amount: fiatAmount,
            rate: buyRate,
            payment_details: {},
            buyer_wallet_address: buyer_wallet_address,
            accepted_at: null,
            ref_price_at_create: buyRate,
            payment_method_id: verifiedPaymentMethodId,
          },
        });
        const data = await resp.json();
        return { data, statusCode: resp.status };
      }
    );

    // ── OFFER-BASED BUY FLOW (commented out — re-enable when ready) ──
    // let offer;
    // if (offer_id) {
    //   offer = await getOfferWithMerchant(offer_id);
    //   if (!offer) return NextResponse.json({ success: false, error: 'Offer not found' }, { status: 404 });
    //   if (offer.available_amount < crypto_amount) return validationErrorResponse([`Insufficient liquidity`]);
    //   if (crypto_amount < offer.min_amount || crypto_amount > offer.max_amount) return validationErrorResponse([`Amount out of bounds`]);
    // } else {
    //   return NextResponse.json({ success: false, error: 'Auto-matching is disabled.' }, { status: 400 });
    // }
    // const fiatAmount = crypto_amount * offer.rate;
    // const createResponse = await proxyCoreApi('/v1/orders', {
    //   method: 'POST',
    //   body: {
    //     user_id, merchant_id: offer.merchant_id, offer_id: offer.id,
    //     type: type, payment_method: offer.payment_method, crypto_amount,
    //     fiat_amount: fiatAmount, rate: offer.rate, payment_details: paymentDetails,
    //     buyer_wallet_address, accepted_at: new Date().toISOString(),
    //     ref_price_at_create: offer.rate, payment_method_id: verifiedPaymentMethodId,
    //     merchant_payment_method_id: merchantPaymentMethodId, liquidity_reserved: true,
    //   },
    // });

    if (idempResult.statusCode < 400) {
      if (idempResult.cached) {
        logger.info('[Orders] Returning cached buy order (idempotency)', { userId: user_id });
      } else {
        auditLog('order.created', user_id, 'user', undefined, {
          type,
          crypto_amount,
        });
      }
    }

    return NextResponse.json(idempResult.data, { status: idempResult.statusCode });
  } catch (error) {
    const err = error as Error;
    console.error('[API] POST /api/orders error:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
    logger.api.error('POST', '/api/orders', err);

    return errorResponse('An error occurred while processing your order');
  }
}
