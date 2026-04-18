import { NextRequest, NextResponse } from 'next/server';
import { getMerchantOrders, getAllPendingOrdersForMerchant } from '@/lib/db/repositories/orders';
import { getMerchantOffers, getOfferWithMerchant } from '@/lib/db/repositories/merchants';
import { createUser } from '@/lib/db/repositories/users';
import { getMerchantDefaultPaymentMethod, getMerchantPaymentMethods } from '@/lib/db/repositories/merchantPaymentMethods';
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
  requireAuth,
  verifyMerchant,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit, ORDER_LIMIT } from '@/lib/middleware/rateLimit';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import { query } from '@/lib/db';
import { signPriceProof } from '@/lib/price/priceProof';
import { getFinalPrice } from '@/lib/price/usdtInrPrice';
import { enrichOrderResponse } from '@/lib/orders/enrichOrderResponse';

// Prevent Next.js from caching this route - orders must always be fresh
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const statusParam = searchParams.get('status');
    const includeAllPending = searchParams.get('include_all_pending') === 'true';
    const cursor = searchParams.get('cursor') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 100);

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

    // Authorization: require authenticated merchant
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'merchant' && auth.actorId === merchant_id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden('GET /api/merchant/orders', auth.actorId, 'Not merchant owner');
      return forbiddenResponse('You can only access your own orders');
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
    const { getMerchantOrdersCache, setMerchantOrdersCache } = await import('@/lib/cache/cacheService');

    // Broadcast lists are NOT cached — they change every time any merchant creates/accepts an order.
    // Only per-merchant lists (non-broadcast) are cached.
    if (!includeAllPending) {
      const cached = await getMerchantOrdersCache<any>(merchant_id);
      if (cached) {
        logger.api.request('GET', '/api/merchant/orders (cache hit)', merchant_id);
        const res = NextResponse.json({ success: true, data: cached });
        res.headers.set('Cache-Control', 'private, max-age=1, stale-while-revalidate=3');
        return res;
      }
    }

    // Fetch from DB
    let orders;
    if (includeAllPending) {
      orders = await getAllPendingOrdersForMerchant(merchant_id, status as any, { cursor, limit });
    } else {
      orders = await getMerchantOrders(merchant_id, status as any, { cursor, limit });
    }

    // Enrich each order with backend-driven UI fields
    const enrichedOrders = (orders || []).map(order => ({
      ...order,
      minimal_status: normalizeStatus(order.status),
      ...enrichOrderResponse(order, merchant_id),
    }));

    // Cache per-merchant list only (NOT broadcast — broadcast changes too frequently)
    if (!includeAllPending) {
      await setMerchantOrdersCache(merchant_id, enrichedOrders);
    }

    // Pagination: next_cursor is the created_at of the last order in this page
    const lastOrder = enrichedOrders[enrichedOrders.length - 1];
    const nextCursor = enrichedOrders.length >= limit && lastOrder?.created_at
      ? lastOrder.created_at
      : null;

    logger.api.request('GET', '/api/merchant/orders', merchant_id);
    const res = NextResponse.json({
      success: true,
      data: enrichedOrders,
      pagination: {
        limit,
        count: enrichedOrders.length,
        next_cursor: nextCursor,
        has_more: enrichedOrders.length >= limit,
      },
    });
    res.headers.set('Cache-Control', 'private, max-age=1, stale-while-revalidate=3');
    return res;
  } catch (error) {
    logger.api.error('GET', '/api/merchant/orders', error as Error);
    return errorResponse('Internal server error');
  }
}

// --- Price engine helpers ---

const PRICE_MAX_DEVIATION = parseFloat(process.env.PRICE_MAX_DEVIATION || '0.15');
const PRICE_GUARDRAILS_ENABLED = process.env.PRICE_GUARDRAILS_ENABLED === 'true';
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache for corridor prices — avoids DB query on every order creation.
// 10s TTL is safe because the corridor price itself has a 5-minute staleness threshold.
const corridorPriceCache = new Map<string, { data: any; expiresAt: number }>();
const CORRIDOR_CACHE_TTL_MS = 10_000; // 10 seconds

async function fetchCorridorRefPrice(corridorId = 'USDT_AED') {
  // Check in-memory cache first
  const cached = corridorPriceCache.get(corridorId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  try {
    const rows = await query<{ ref_price: string; updated_at: Date; confidence: string }>(
      'SELECT ref_price, updated_at, confidence FROM corridor_prices WHERE corridor_id = $1',
      [corridorId]
    );
    if (!rows[0]) return null;
    const ageMs = Date.now() - new Date(rows[0].updated_at).getTime();
    const result = {
      ref_price: parseFloat(rows[0].ref_price),
      confidence: rows[0].confidence || 'low',
      is_stale: ageMs > STALE_THRESHOLD_MS,
    };

    // Cache the result
    corridorPriceCache.set(corridorId, { data: result, expiresAt: Date.now() + CORRIDOR_CACHE_TTL_MS });

    return result;
  } catch (err) {
    logger.error('Failed to fetch corridor ref price', { corridorId, error: String(err) });
    return null;
  }
}

// Merchant-initiated order creation
export async function POST(request: NextRequest) {
  // Rate limit: 20 orders per minute
  const rateLimitResponse = await checkRateLimit(request, 'merchant-orders:create', ORDER_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();

    // Authorization: require authenticated merchant
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Validate request body
    const parseResult = merchantCreateOrderSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    // Dry run: validate schema + business logic, don't create order.
    // Used by frontend to pre-validate BEFORE locking escrow on-chain.
    const isDryRun = request.nextUrl.searchParams.get('dry_run') === 'true';

    // Pair (currency corridor) — defaults to usdt_aed for backward compat.
    // Drives the rate source AND the order's fiat_currency / corridor_id.
    const pairFromBody = (body?.pair === 'usdt_inr' || body?.pair === 'USDT_INR') ? 'usdt_inr' : 'usdt_aed';
    const corridorId = pairFromBody === 'usdt_inr' ? 'USDT_INR' : 'USDT_AED';
    const fiatCurrency = pairFromBody === 'usdt_inr' ? 'INR' : 'AED';
    const fallbackRate = pairFromBody === 'usdt_inr' ? 83.0 : 3.67;

    const {
      merchant_id,
      type,
      crypto_amount,
      payment_method,
      spread_preference,
      priority_fee,
      offer_id,
      target_merchant_id,
      merchant_payment_method_id: requestedPmId,
      escrow_tx_hash,
      escrow_trade_id,
      escrow_trade_pda,
      escrow_pda,
      escrow_creator_wallet,
      expiry_minutes,
    } = parseResult.data;

    // Verify the authenticated merchant matches the merchant_id in request
    if (auth.actorType === 'merchant' && auth.actorId !== merchant_id) {
      logger.auth.forbidden('POST /api/merchant/orders', auth.actorId, 'Creating order for different merchant');
      return forbiddenResponse('You can only create orders for yourself');
    }

    // L1: Reject self-trade attempts at the API boundary.
    // A merchant cannot trade with themselves — no price discovery, no
    // counterparty, and historically these orders were created as cancelled
    // noise in the DB. Previously silently treated as non-M2M.
    if (target_merchant_id && target_merchant_id === merchant_id) {
      return validationErrorResponse(['Cannot create a trade with yourself']);
    }

    // Verify merchant(s) exist — parallelize if M2M
    const isM2MTrade = !!target_merchant_id && target_merchant_id !== merchant_id;
    const [merchantExists, targetMerchantExists] = await Promise.all([
      verifyMerchant(merchant_id),
      isM2MTrade ? verifyMerchant(target_merchant_id) : Promise.resolve(true),
    ]);

    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }
    if (isM2MTrade && !targetMerchantExists) {
      return validationErrorResponse(['Target merchant not found or not active']);
    }

    // Create a placeholder user for merchant-initiated orders.
    // Skip during dry_run — we only need to validate, not create DB records.
    let user: { id: string } | undefined;
    if (isDryRun) {
      user = { id: 'dry-run-placeholder' };
    }
    if (!isDryRun) {
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
    }

    // ── DIRECT ORDER CREATION (no offer matching) ───────────────────────
    // Offer matching is disabled. Orders are created with corridor ref_price
    // and broadcast to all merchants for manual acceptance.

    // --- Price engine: resolve rate based on the selected pair ---
    // Honor admin's manual price (same source as dashboard market card via
    // getFinalPrice), and fall back to corridor VWAP / hardcoded fallback.
    let effectiveRate = fallbackRate;
    let priceProofRefPrice: number | null = null;
    try {
      const finalPrice = await getFinalPrice(pairFromBody);
      if (finalPrice.price > 0) {
        effectiveRate = finalPrice.price;
        priceProofRefPrice = finalPrice.price;
      }
    } catch (err) {
      logger.warn('getFinalPrice failed for order creation, falling back to corridor VWAP', { pair: pairFromBody, error: String(err) });
    }
    if (priceProofRefPrice === null) {
      const corridorData = await fetchCorridorRefPrice(corridorId);
      if (corridorData?.ref_price) {
        effectiveRate = corridorData.ref_price;
        priceProofRefPrice = corridorData.ref_price;
      }
    }
    effectiveRate = Math.round(effectiveRate * 10000) / 10000;

    let priceProofSig: string | null = null;
    let priceProofExpiresAt: string | null = null;

    if (priceProofRefPrice !== null) {
      const proof = signPriceProof({
        corridor_id: corridorId,
        ref_price: priceProofRefPrice,
        order_rate: effectiveRate,
        deviation_bps: 0,
        timestamp: Date.now(),
      });
      priceProofSig = proof.sig;
      priceProofExpiresAt = new Date(proof.expires_at).toISOString();
    }

    const fiatAmount = crypto_amount * effectiveRate;

    // Protocol fee
    const baseFee = spread_preference === 'best' ? 2.00
      : spread_preference === 'fastest' ? 2.50
      : 1.50;
    const protocolFeePercentage = baseFee + (priority_fee || 0);
    const protocolFeeAmount = crypto_amount * (protocolFeePercentage / 100);

    // Bump/decay fields
    const priorityFeePct = priority_fee || 0;
    const premiumBpsCap = Math.round(priorityFeePct * 100);
    const autoBumpEnabled = premiumBpsCap > 0;
    const bumpStepBps = 10;
    const bumpIntervalSec = 30;

    logger.info('Order created (direct, no offer matching)', {
      merchant_id,
      type,
      crypto_amount,
      fiat_amount: fiatAmount,
      effective_rate: effectiveRate,
      ref_price: priceProofRefPrice,
      pair: pairFromBody,
      spread_preference,
    });

    // For merchant-initiated orders, the type from merchant's perspective:
    // - 'sell' = merchant sells USDT → order type is 'buy' (user perspective)
    // - 'buy' = merchant buys USDT → order type is 'sell' (user perspective)
    const orderType = type === 'sell' ? 'buy' : 'sell';

    // Slot assignment per CLAUDE.md M2M invariant (merchant_id=ALWAYS seller,
    // buyer_merchant_id=ALWAYS buyer):
    //   targeted M2M:      creator is buyer → merchant_id=target, bmerch=creator
    //   self-broadcast SELL (merchant sells): creator is seller → merchant_id=creator, bmerch=null
    //   self-broadcast BUY  (merchant buys):  creator is buyer  → merchant_id=null,    bmerch=creator
    // The `merchant_id IS NULL` shape is picked up by getAllPendingOrdersForMerchant
    // (orders.ts:457) and the M2M acceptance path (orders.ts:910-931 / 955-972),
    // which sets merchant_id=acceptor on claim.
    const creatorIsSeller = type === 'sell';

    // Defensive: only sellers lock escrow. A BUY-intent self-broadcast has the
    // creator as buyer, so escrow_tx_hash must not be present at creation —
    // the seller will claim and lock later. Reject rather than silently
    // writing a NULL funder to the ledger.
    if (!isM2MTrade && !creatorIsSeller && escrow_tx_hash) {
      return validationErrorResponse([
        'escrow_tx_hash is not allowed on buy-intent broadcasts — the seller locks escrow on claim',
      ]);
    }

    const orderMerchantId: string | null = isM2MTrade
      ? target_merchant_id
      : (creatorIsSeller ? merchant_id : null);
    const buyerMerchantId: string | undefined = isM2MTrade
      ? merchant_id
      : (creatorIsSeller ? undefined : merchant_id);

    // Resolve the seller's payment method so the buyer knows where to send fiat.
    // Only meaningful when a seller is already assigned (orderMerchantId set).
    // For self-broadcast BUY (orderMerchantId=null), the seller claims later and
    // brings their own payment method at claim time.
    let sellerPaymentMethodId: string | undefined;
    if (!isM2MTrade && creatorIsSeller) {
      // For self-broadcast SELL: creator (merchant_id) is the seller
      if (requestedPmId) {
        const owned = await getMerchantPaymentMethods(merchant_id);
        if (owned.some((pm) => pm.id === requestedPmId)) {
          sellerPaymentMethodId = requestedPmId;
        }
      }
      // Fallback to merchant's default payment method
      if (!sellerPaymentMethodId) {
        const defaultPm = await getMerchantDefaultPaymentMethod(merchant_id);
        if (defaultPm?.id) sellerPaymentMethodId = defaultPm.id;
      }
      logger.info('[Merchant Order] Payment method resolved', {
        merchant_id,
        requested: requestedPmId,
        resolved: sellerPaymentMethodId,
        creatorIsSeller,
      });
    }

    // Offer lookup: only for targeted M2M orders where a specific seller
    // is assigned. Self-broadcast orders (both BUY and SELL) don't need an
    // offer — rate comes from the admin price engine and payment method
    // from the merchant's selection. Looking up the creator's own offer
    // for a BUY broadcast incorrectly shows the buyer's bank details as
    // the seller's payment method and deducts from the wrong liquidity pool.
    let fallbackOfferId: string | null = null;
    if (isM2MTrade && orderMerchantId) {
      try {
        const merchantOffers = await getMerchantOffers(orderMerchantId);
        const activeOffer = merchantOffers.find(o => o.is_active);
        fallbackOfferId = activeOffer?.id || merchantOffers[0]?.id || null;
      } catch {
        // No offers — will use null
      }
    }

    // Dry run: all business validations passed (merchant exists, rate resolved,
    // payment method resolved, placeholder user ready). Return early BEFORE
    // the core-api proxy call so frontend can safely proceed to lock escrow.
    if (isDryRun) {
      return successResponse({ valid: true, rate: effectiveRate, corridor_id: corridorId });
    }

    // Forward to core-api
    const response = await proxyCoreApi('/v1/merchant/orders', {
      method: 'POST',
      body: {
        merchant_id: orderMerchantId,
        user_id: user.id,
        offer_id: fallbackOfferId,
        type: orderType,
        payment_method,
        merchant_payment_method_id: sellerPaymentMethodId,
        crypto_amount,
        fiat_amount: fiatAmount,
        rate: effectiveRate,
        payment_details: {},
        spread_preference,
        protocol_fee_percentage: protocolFeePercentage,
        protocol_fee_amount: protocolFeeAmount,
        buyer_merchant_id: buyerMerchantId,
        escrow_tx_hash,
        escrow_trade_id,
        escrow_trade_pda,
        escrow_pda,
        escrow_creator_wallet,
        ref_price_at_create: priceProofRefPrice ?? effectiveRate,
        price_proof_sig: priceProofSig,
        price_proof_ref_price: priceProofRefPrice,
        price_proof_expires_at: priceProofExpiresAt,
        premium_bps_current: 0,
        premium_bps_cap: premiumBpsCap,
        bump_step_bps: bumpStepBps,
        bump_interval_sec: bumpIntervalSec,
        auto_bump_enabled: autoBumpEnabled,
        next_bump_at: autoBumpEnabled ? new Date(Date.now() + bumpIntervalSec * 1000).toISOString() : null,
        expiry_minutes: expiry_minutes || 15,
        // Currency corridor: drives DB columns orders.corridor_id and orders.fiat_currency
        corridor_id: corridorId,
        fiat_currency: fiatCurrency,
      },
    });

    // Invalidate creating merchant's order list cache.
    // For self-broadcast BUY (orderMerchantId=null), invalidate the buyer merchant's cache
    // instead — that's the creator whose list just got a new order.
    if (response.status < 400) {
      const { invalidateMerchantOrderListCache } = await import('@/lib/cache/cacheService');
      const cacheInvalidationId = orderMerchantId ?? buyerMerchantId ?? merchant_id;
      if (cacheInvalidationId) {
        await invalidateMerchantOrderListCache(cacheInvalidationId);
      }
    }

    // Pusher notifications are now triggered by Core API directly
    return response;
  } catch (error) {
    const err = error as Error;
    logger.api.error('POST', '/api/merchant/orders', err);
    console.error('[API] Error creating merchant order:', {
      name: err.name,
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return errorResponse('An error occurred while processing your order');
  }
}
