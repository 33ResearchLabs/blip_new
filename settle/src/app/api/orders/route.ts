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
    });

    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { user_id } = parseResult.data;

    // Authorization: require authenticated user
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === user_id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden('GET /api/orders', auth.actorId, 'Not order owner');
      return forbiddenResponse('You can only access your own orders');
    }

    const orders = await getUserOrders(user_id);

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
      // ── AUTO-MATCHING DISABLED — manual trading only for now ──
      // Uncomment below to re-enable offer-based auto-matching
      //
      // const offerType = type === 'buy' ? 'sell' : 'buy';
      // offer = await findBestOffer(
      //   crypto_amount,
      //   offerType as OfferType,
      //   (payment_method as PaymentMethod) || 'bank',
      //   preference || 'best'
      // );
      //
      // if (!offer) {
      //   return NextResponse.json(
      //     { success: false, error: 'No matching offers available' },
      //     { status: 404 }
      //   );
      // }
      return NextResponse.json(
        { success: false, error: 'Auto-matching is disabled. Please use merchant-posted orders.' },
        { status: 400 }
      );
    }

    // Price guardrail: reject if offer rate deviates too far from corridor reference price
    const PRICE_MAX_DEVIATION = parseFloat(process.env.PRICE_MAX_DEVIATION || '0.15');
    const PRICE_GUARDRAILS_ENABLED = process.env.PRICE_GUARDRAILS_ENABLED === 'true';
    if (PRICE_GUARDRAILS_ENABLED) {
      try {
        const corridorRows = await dbQuery<{ ref_price: string; updated_at: Date }>(
          'SELECT ref_price, updated_at FROM corridor_prices WHERE corridor_id = $1',
          ['USDT_AED']
        );
        if (corridorRows[0]) {
          const refPrice = parseFloat(corridorRows[0].ref_price);
          const ageMs = Date.now() - new Date(corridorRows[0].updated_at).getTime();
          const isStale = ageMs > 5 * 60 * 1000;
          if (!isStale && refPrice > 0) {
            const deviation = Math.abs(offer.rate - refPrice) / refPrice;
            if (deviation > PRICE_MAX_DEVIATION) {
              return NextResponse.json(
                {
                  success: false,
                  error: `Offer rate ${offer.rate.toFixed(4)} deviates ${(deviation * 100).toFixed(1)}% from market rate. Max allowed: ${(PRICE_MAX_DEVIATION * 100).toFixed(0)}%.`,
                  code: 'PRICE_GUARDRAIL',
                },
                { status: 422 }
              );
            }
          }
        }
      } catch {
        // Non-blocking: if corridor price check fails, allow order to proceed
      }
    }

    // Calculate fiat amount
    const fiatAmount = crypto_amount * offer.rate;

    // Look up merchant's default payment method (where buyer should send fiat)
    let merchantPaymentMethodId: string | undefined;
    const merchantPm = await getMerchantDefaultPaymentMethod(offer.merchant_id);
    if (merchantPm) {
      merchantPaymentMethodId = merchantPm.id;
    }

    // Build payment details snapshot
    // For sell orders, include user's bank account where merchant will send fiat
    // user_bank_account may be a JSON string with structured details or a plain text string
    let parsedUserBank: Record<string, string> | string | undefined;
    if (type === 'sell' && user_bank_account) {
      try {
        const parsed = JSON.parse(user_bank_account);
        if (parsed && typeof parsed === 'object' && parsed.bank_name) {
          parsedUserBank = parsed;
        } else {
          parsedUserBank = user_bank_account;
        }
      } catch {
        parsedUserBank = user_bank_account;
      }
    }

    const paymentDetails =
      offer.payment_method === 'bank'
        ? {
            bank_name: offer.bank_name,
            bank_account_name: offer.bank_account_name,
            bank_iban: offer.bank_iban,
            user_bank_account: parsedUserBank,
          }
        : {
            location_name: offer.location_name,
            location_address: offer.location_address,
            location_lat: offer.location_lat,
            location_lng: offer.location_lng,
            meeting_instructions: offer.meeting_instructions,
            user_bank_account: parsedUserBank,
          };

    // TASK 6: Atomically reserve liquidity before creating order.
    // Deduct offer available_amount in a transaction, then proxy to core-api.
    // If core-api fails, roll back the reservation to prevent liquidity leak.
    let liquidityReserved = false;
    try {
      await transaction(async (client) => {
        // Lock the offer row and re-check liquidity
        const offerLock = await client.query(
          `SELECT available_amount FROM merchant_offers WHERE id = $1 FOR UPDATE`,
          [offer.id]
        );
        if (offerLock.rows.length === 0) {
          throw new Error('OFFER_NOT_FOUND');
        }
        const currentAvailable = parseFloat(String(offerLock.rows[0].available_amount));
        if (currentAvailable < crypto_amount) {
          throw new Error('INSUFFICIENT_LIQUIDITY');
        }
        // Reserve liquidity
        await client.query(
          `UPDATE merchant_offers SET available_amount = available_amount - $1 WHERE id = $2`,
          [crypto_amount, offer.id]
        );
      });
      liquidityReserved = true;
    } catch (reserveErr) {
      const errMsg = (reserveErr as Error).message;
      if (errMsg === 'INSUFFICIENT_LIQUIDITY') {
        return validationErrorResponse([
          `Insufficient liquidity. Requested: ${crypto_amount}`,
        ]);
      }
      if (errMsg === 'OFFER_NOT_FOUND') {
        return NextResponse.json(
          { success: false, error: 'Offer no longer available' },
          { status: 404 }
        );
      }
      throw reserveErr;
    }

    // ── SELL ORDER ENFORCEMENT: escrow-first model ────────────────────
    // SELL orders MUST lock escrow at creation. The user is the seller.
    // Without escrow, the order cannot be created — this prevents SELL orders
    // from entering 'pending' or 'accepted' status.
    if (type === 'sell' && !escrow_tx_hash) {
      return validationErrorResponse([
        'SELL orders require escrow to be locked at creation. Provide escrow_tx_hash and related fields.',
      ]);
    }

    // For sell orders, forward escrow fields so core-api sets status to 'escrowed' directly.
    const escrowFields = type === 'sell' ? {
      escrow_tx_hash,
      escrow_trade_id,
      escrow_trade_pda,
      escrow_pda,
      escrow_creator_wallet,
    } : {};

    // Forward to core-api (single writer for all mutations)
    const createResponse = await proxyCoreApi('/v1/orders', {
      method: 'POST',
      body: {
        user_id,
        merchant_id: offer.merchant_id,
        offer_id: offer.id,
        type: type as OfferType,
        payment_method: offer.payment_method,
        crypto_amount,
        fiat_amount: fiatAmount,
        rate: offer.rate,
        payment_details: paymentDetails,
        buyer_wallet_address: type === 'buy' ? buyer_wallet_address : undefined,
        // Merchant implicitly accepted by publishing the offer — record acceptance time
        accepted_at: new Date().toISOString(),
        // buyer_merchant_id is NOT set for user-created orders.
        // It is ONLY for M2M trades (set via /api/merchant/orders).
        ref_price_at_create: offer.rate,
        payment_method_id: verifiedPaymentMethodId,
        merchant_payment_method_id: merchantPaymentMethodId,
        liquidity_reserved: true, // Signal core-api that liquidity is already deducted
        ...escrowFields,
      },
    });

    // If core-api failed, roll back the liquidity reservation
    if (liquidityReserved && createResponse.status >= 400) {
      try {
        await transaction(async (client) => {
          await client.query(
            `UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2`,
            [crypto_amount, offer.id]
          );
        });
        logger.api.request('POST', '/api/orders — liquidity reservation rolled back', user_id);
      } catch (rollbackErr) {
        logger.api.error('POST', '/api/orders — CRITICAL: liquidity rollback failed', rollbackErr as Error);
        return errorResponse(
          'Order creation failed and liquidity rollback also failed. Please contact support.',
          500
        );
      }
    }

    if (createResponse.status < 400) {
      auditLog('order.created', user_id, 'user', undefined, {
        offerId: offer?.id,
        type,
        crypto_amount,
        merchantId: offer?.merchant_id,
      });
    }

    return createResponse;
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
