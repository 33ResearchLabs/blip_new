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
import { getFinalPrice } from '@/lib/price/usdtInrPrice';
import { getCurrentFeeBps } from '@/lib/money/feeBps';
import { checkDrift } from '@/lib/money/driftGuard';
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
      expected_rate,
      expected_fee_bps,
    } = parseResult.data;

    // Authorization: require authenticated user creating order for themselves
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === user_id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden('POST /api/orders', auth.actorId, 'Creating order for different user');
      return forbiddenResponse('You can only create orders for yourself');
    }

    // Quick synchronous validations first (no DB calls)
    guardOrderCreation(user_id, type, crypto_amount);

    const explicitKey = getIdempotencyKey(request);
    const timeWindow = Math.floor(Date.now() / 30000);
    const autoKey = createHash('sha256')
      .update(`create_order:${user_id}:${type}:${crypto_amount}:${payment_method || 'bank'}:${timeWindow}`)
      .digest('hex');
    const idempotencyKey = explicitKey || autoKey;

    if (type === 'buy' && !buyer_wallet_address) {
      return validationErrorResponse(['buyer_wallet_address is required for buy orders. Please connect your wallet.']);
    }

    // Parallelize independent DB lookups: user verification + payment method check
    // These don't depend on each other and can run concurrently.
    const [userExists, verifiedPm] = await Promise.all([
      verifyUser(user_id),
      payment_method_id ? verifyPaymentMethodOwnership(payment_method_id, user_id) : Promise.resolve(null),
    ]);

    if (!userExists) {
      return validationErrorResponse(['User not found']);
    }

    let verifiedPaymentMethodId: string | undefined;
    if (payment_method_id) {
      if (!verifiedPm) {
        return validationErrorResponse(['Invalid or inactive payment method']);
      }
      verifiedPaymentMethodId = verifiedPm.id;
    }

    // ── SELL ORDERS: manual merchant-claim model (no offer matching) ────
    // Sell orders are broadcast to all merchants. No merchant_id assigned.
    // A merchant must manually claim via POST /api/orders/:id/claim.
    // Pair / corridor selection — defaults to usdt_aed for backward compat.
    const pairFromBody = ((body as any)?.pair === 'usdt_inr' || (body as any)?.pair === 'USDT_INR') ? 'usdt_inr' : 'usdt_aed';
    const orderCorridorId = pairFromBody === 'usdt_inr' ? 'USDT_INR' : 'USDT_AED';
    const orderFiatCurrency = pairFromBody === 'usdt_inr' ? 'INR' : 'AED';

    if (type === 'sell') {
      if (!escrow_tx_hash) {
        return validationErrorResponse([
          'SELL orders require escrow to be locked at creation. Provide escrow_tx_hash and related fields.',
        ]);
      }

      // Fetch authoritative rate AND fee_bps in parallel. Both are snapshotted
      // into the order so the UI can render deterministic payouts at every phase.
      let sellRate: number | null = null;
      let feeBps: number = 0;
      try {
        const [finalPrice, currentFeeBps] = await Promise.all([
          getFinalPrice(pairFromBody),
          getCurrentFeeBps(),
        ]);
        if (finalPrice.price > 0) sellRate = finalPrice.price;
        feeBps = currentFeeBps;
      } catch { /* sellRate stays null */ }
      if (!sellRate || sellRate <= 0) {
        return errorResponse('Exchange rate temporarily unavailable. Please try again in a moment.');
      }

      // Reject silently-drifted quotes. Client can refresh and re-submit.
      const drift = checkDrift({
        actualRate: sellRate,
        actualFeeBps: feeBps,
        expectedRate: expected_rate,
        expectedFeeBps: expected_fee_bps,
      });
      if (!drift.ok) {
        return NextResponse.json({ success: false, ...drift.conflict }, { status: 409 });
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
              fee_bps: feeBps,
              payment_details: { user_bank_account: parsedUserBank },
              accepted_at: null,
              ref_price_at_create: sellRate,
              payment_method_id: verifiedPaymentMethodId,
              escrow_tx_hash,
              escrow_trade_id,
              escrow_trade_pda,
              escrow_pda,
              escrow_creator_wallet,
              corridor_id: orderCorridorId,
              fiat_currency: orderFiatCurrency,
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

    let buyRate: number | null = null;
    let buyFeeBps: number = 0;
    try {
      const [finalPrice, currentFeeBps] = await Promise.all([
        getFinalPrice(pairFromBody),
        getCurrentFeeBps(),
      ]);
      if (finalPrice.price > 0) buyRate = finalPrice.price;
      buyFeeBps = currentFeeBps;
    } catch { /* buyRate stays null */ }
    if (!buyRate || buyRate <= 0) {
      return errorResponse('Exchange rate temporarily unavailable. Please try again in a moment.');
    }

    const buyDrift = checkDrift({
      actualRate: buyRate,
      actualFeeBps: buyFeeBps,
      expectedRate: expected_rate,
      expectedFeeBps: expected_fee_bps,
    });
    if (!buyDrift.ok) {
      return NextResponse.json({ success: false, ...buyDrift.conflict }, { status: 409 });
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
            fee_bps: buyFeeBps,
            payment_details: {},
            buyer_wallet_address: buyer_wallet_address,
            accepted_at: null,
            ref_price_at_create: buyRate,
            payment_method_id: verifiedPaymentMethodId,
            corridor_id: orderCorridorId,
            fiat_currency: orderFiatCurrency,
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
