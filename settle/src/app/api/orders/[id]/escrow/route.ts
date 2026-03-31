import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrderWithRelations } from "@/lib/db/repositories/orders";
import { logger } from "settlement-core";
import { proxyCoreApi } from "@/lib/proxy/coreApi";
import { uuidSchema } from "@/lib/validation/schemas";
import {
  requireAuth,
  requireTokenAuth,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from "@/lib/middleware/auth";
import { checkRateLimit, STRICT_LIMIT } from "@/lib/middleware/rateLimit";
import { serializeOrder } from "@/lib/api/orderSerializer";
import { getIdempotencyKey, withIdempotency } from "@/lib/idempotency";
import { mockEscrowLock, determineEscrowPayer } from "@/lib/money/escrowLock";
import { auditLog } from "@/lib/auditLog";
import { resolveTradeRole } from "@/lib/orders/handleOrderAction";
import { normalizeStatus } from "@/lib/orders/statusNormalizer";

// Schema for escrow deposit
const escrowDepositSchema = z.object({
  tx_hash: z.string().min(1, "Transaction hash is required"),
  actor_type: z.enum(["user", "merchant"]),
  actor_id: z.string().uuid(),
  escrow_address: z.string().nullish(),
  // On-chain escrow references for release
  escrow_trade_id: z.number().nullish(),
  escrow_trade_pda: z.string().nullish(),
  escrow_pda: z.string().nullish(),
  escrow_creator_wallet: z.string().nullish(),
});

// Schema for escrow release
const escrowReleaseSchema = z.object({
  tx_hash: z.string().min(1, "Transaction hash is required"),
  actor_type: z.enum(["user", "merchant", "system"]),
  actor_id: z.string().uuid(),
});

// GET - Get escrow status for an order (read-only, stays local)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(["Invalid order ID format"]);
    }

    // Require token auth for escrow operations (sensitive financial action)
    const auth = await requireTokenAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Fetch order
    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse("Order");
    }

    // Check authorization
    const canAccess = await canAccessOrder(auth, id);
    // if (!canAccess) {
    //   return forbiddenResponse('You do not have access to this order');
    // }

    // Return escrow details with minimal_status
    const escrowData = serializeOrder({
      order_id: order.id,
      status: order.status,
      escrow_tx_hash: order.escrow_tx_hash,
      escrow_address: order.escrow_address,
      release_tx_hash: order.release_tx_hash,
      escrowed_at: order.escrowed_at,
      crypto_amount: order.crypto_amount,
      crypto_currency: order.crypto_currency,
      is_escrowed: [
        "escrowed",
        "payment_pending",
        "payment_sent",
        "payment_confirmed",
        "releasing",
      ].includes(order.status),
      is_released: order.status === "completed" && order.release_tx_hash,
    });

    return successResponse(escrowData);
  } catch (error) {
    logger.api.error("GET", "/api/orders/[id]/escrow", error as Error);
    return errorResponse("Internal server error");
  }
}

// POST - Record escrow deposit (proxied to core-api)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Rate limit: 10 escrow operations per minute
  const rateLimitResponse = await checkRateLimit(
    request,
    "escrow:deposit",
    STRICT_LIMIT,
  );
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(["Invalid order ID format"]);
    }

    const body = await request.json();

    // Require token auth for escrow deposit (sensitive financial action)
    const auth = await requireTokenAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Validate request body
    const parseResult = escrowDepositSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(
        (e) => `${e.path.join(".")}: ${e.message}`,
      );
      return validationErrorResponse(errors);
    }

    // Security: enforce actor matches authenticated identity
    // Must run BEFORE canAccessOrder so auth context is correct
    const headerMerchantId = request.headers.get("x-merchant-id");
    const actorMatchesAuth = parseResult.data.actor_id === auth.actorId;
    const actorMatchesMerchant =
      parseResult.data.actor_type === "merchant" &&
      headerMerchantId &&
      parseResult.data.actor_id === headerMerchantId;
    if (!actorMatchesAuth && !actorMatchesMerchant) {
      return forbiddenResponse(
        "actor_id does not match authenticated identity",
      );
    }
    if (!actorMatchesAuth && actorMatchesMerchant) {
      auth.actorType = "merchant";
      auth.actorId = headerMerchantId;
      auth.merchantId = headerMerchantId;
    }
    // Ensure merchantId is always set when x-merchant-id header is present,
    // even if actorMatchesAuth is true (user's auth ID matched).
    // Without this, canAccessOrder with actorType='user' can't check merchant_id.
    if (headerMerchantId && !auth.merchantId) {
      auth.merchantId = headerMerchantId;
    }

    // Verify access to this order (after auth context is resolved)
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse("You do not have access to this order");
    }

    // Acquire row-level lock to prevent parallel escrow locks (double-spend)
    const { query: lockQuery } = await import("@/lib/db");
    const lockResult = await lockQuery(
      `SELECT id FROM orders WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!lockResult || lockResult.length === 0) {
      return notFoundResponse("Order");
    }

    // Fetch order FRESH from DB (skip cache — merchant_id may have just been set by accept)
    const { invalidateOrderCache } = await import("@/lib/cache");
    invalidateOrderCache(id);
    const depositOrder = await getOrderWithRelations(id);
    if (!depositOrder) {
      return notFoundResponse("Order");
    }

    // ── ROLE + STATUS VALIDATION ──
    // Only the seller can lock escrow.
    // Allowed from:
    //   - 'accepted' (BUY flow: merchant accepted, now locks escrow)
    //   - 'open' (placeholder user: merchant locks escrow at creation)
    //   - 'escrowed' (idempotent: SELL orders already escrowed at creation,
    //                  this call just updates on-chain refs like tx_hash)
    const minimalStatus = normalizeStatus(depositOrder.status);
    const isPlaceholderUser = depositOrder.user?.username?.startsWith('open_order_')
      || depositOrder.user?.username?.startsWith('m2m_');
    const allowOpenEscrow = minimalStatus === "open" && isPlaceholderUser;
    const isAlreadyEscrowed = minimalStatus === "escrowed";

    if (isAlreadyEscrowed) {
      // Idempotent: order already escrowed (SELL escrow-first flow).
      // Update on-chain references if needed, but don't change status.
      logger.info("[Escrow:Deposit] Order already escrowed — updating on-chain refs only", {
        orderId: id,
        currentStatus: depositOrder.status,
        existingTxHash: depositOrder.escrow_tx_hash,
        newTxHash: parseResult.data.tx_hash,
      });

      // Update escrow fields on the existing escrowed order
      const { query: dbQuery } = await import("@/lib/db");
      await dbQuery(
        `UPDATE orders SET
           escrow_tx_hash = COALESCE($2, escrow_tx_hash),
           escrow_trade_id = COALESCE($3, escrow_trade_id),
           escrow_trade_pda = COALESCE($4, escrow_trade_pda),
           escrow_pda = COALESCE($5, escrow_pda),
           escrow_creator_wallet = COALESCE($6, escrow_creator_wallet),
           escrow_address = COALESCE($7, escrow_address)
         WHERE id = $1`,
        [
          id,
          parseResult.data.tx_hash,
          parseResult.data.escrow_trade_id ?? null,
          parseResult.data.escrow_trade_pda ?? null,
          parseResult.data.escrow_pda ?? null,
          parseResult.data.escrow_creator_wallet ?? null,
          parseResult.data.escrow_address ?? null,
        ],
      );

      // Return the updated order
      const updatedOrder = await getOrderWithRelations(id);
      return successResponse(updatedOrder);
    }

    if (minimalStatus !== "accepted" && !allowOpenEscrow) {
      logger.warn(
        "[Escrow:Deposit] Rejected — invalid status for escrow lock",
        {
          orderId: id,
          currentStatus: depositOrder.status,
          minimalStatus,
        },
      );
      return NextResponse.json(
        {
          success: false,
          error: `Cannot lock escrow from status '${minimalStatus}'. Order must be in 'accepted' or 'open' status.`,
          code: "INVALID_STATUS_FOR_ESCROW",
        },
        { status: 400 },
      );
    }

    const role = resolveTradeRole(depositOrder, parseResult.data.actor_id);
    if (role !== "seller") {
      logger.warn("[Escrow:Deposit] Rejected — only seller can lock escrow", {
        orderId: id,
        actorId: parseResult.data.actor_id,
        resolvedRole: role,
      });
      return NextResponse.json(
        {
          success: false,
          error: "Only the seller can lock escrow.",
          code: "ROLE_MISMATCH",
        },
        { status: 403 },
      );
    }

    const sellerId = determineEscrowPayer({
      type: depositOrder.type as "buy" | "sell",
      merchant_id: depositOrder.merchant_id,
      user_id: depositOrder.user_id,
      buyer_merchant_id: depositOrder.buyer_merchant_id,
    }).entityId;

    logger.info("[Escrow:Deposit] Attempting escrow lock", {
      orderId: id,
      actorId: parseResult.data.actor_id,
      actorType: parseResult.data.actor_type,
      sellerId,
      cryptoAmount: depositOrder?.crypto_amount ?? null,
      cryptoCurrency: depositOrder?.crypto_currency ?? null,
      orderStatus: depositOrder?.status ?? null,
      txHash: parseResult.data.tx_hash,
    });

    // Forward to core-api (single writer for all mutations)
    const depositResponse = await proxyCoreApi(`/v1/orders/${id}/escrow`, {
      method: "POST",
      body: parseResult.data,
    });

    const depositSuccess = depositResponse.status < 400;
    if (depositSuccess) {
      auditLog('escrow.locked', parseResult.data.actor_id, parseResult.data.actor_type, id, {
        txHash: parseResult.data.tx_hash,
        cryptoAmount: depositOrder?.crypto_amount,
        sellerId,
      });
    }
    logger.info(`[Escrow:Deposit] ${depositSuccess ? "Success" : "Failed"}`, {
      orderId: id,
      actorId: parseResult.data.actor_id,
      sellerId,
      cryptoAmount: depositOrder?.crypto_amount ?? null,
      httpStatus: depositResponse.status,
      success: depositSuccess,
    });

    // Pusher notifications are now triggered by Core API directly
    return depositResponse;
  } catch (error) {
    logger.api.error("POST", "/api/orders/[id]/escrow", error as Error);
    return errorResponse("Internal server error");
  }
}

// PATCH - Record escrow release (proxied to core-api)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(["Invalid order ID format"]);
    }

    const body = await request.json();

    // Require token auth for escrow release (sensitive financial action)
    const auth = await requireTokenAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Validate request body
    const parseResult = escrowReleaseSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(
        (e) => `${e.path.join(".")}: ${e.message}`,
      );
      return validationErrorResponse(errors);
    }

    const { tx_hash, actor_type, actor_id } = parseResult.data;

    // Security: enforce actor matches authenticated identity (with merchant header fallback)
    // Must run BEFORE canAccessOrder so auth context is correct
    const relHeaderMerchantId = request.headers.get("x-merchant-id");
    const relActorMatchesAuth = actor_id === auth.actorId;
    const relActorMatchesMerchant =
      actor_type === "merchant" &&
      relHeaderMerchantId &&
      actor_id === relHeaderMerchantId;
    if (!relActorMatchesAuth && !relActorMatchesMerchant) {
      return forbiddenResponse(
        "actor_id does not match authenticated identity",
      );
    }
    if (!relActorMatchesAuth && relActorMatchesMerchant) {
      auth.actorType = "merchant";
      auth.actorId = relHeaderMerchantId;
      auth.merchantId = relHeaderMerchantId;
    }

    // Verify access to this order (after auth context is resolved)
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse("You do not have access to this order");
    }

    // ── Fetch order for authorization & integrity checks ──
    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse("Order");
    }

    // Reject release if no escrow was ever locked — with optional auto-escrow fallback
    if (!order.escrow_debited_entity_id) {
      // AUTO-ESCROW SAFE MODE: if the order is in 'accepted' and the caller is the seller,
      // attempt to lock escrow automatically before proceeding. This covers edge cases
      // where the escrow step was skipped due to client-side failures.
      const autoEscrowEligibleStatuses = ["accepted", "escrow_pending"];
      const payer = determineEscrowPayer({
        type: order.type as "buy" | "sell",
        merchant_id: order.merchant_id,
        user_id: order.user_id,
        buyer_merchant_id: order.buyer_merchant_id,
      });
      const callerIsSeller = actor_id === payer.entityId;

      if (autoEscrowEligibleStatuses.includes(order.status) && callerIsSeller) {
        logger.info(
          "[Release] Auto-escrow attempt — escrow missing, seller is caller",
          {
            orderId: id,
            actorId: actor_id,
            payerEntityId: payer.entityId,
            orderStatus: order.status,
          },
        );

        const autoTxHash = `auto-escrow-${id}-${Date.now()}`;
        const escrowResult = await mockEscrowLock(
          id,
          actor_type as any,
          actor_id,
          autoTxHash,
        );

        if (!escrowResult.success) {
          logger.warn("[Release] Auto-escrow failed — rejecting release", {
            orderId: id,
            error: escrowResult.error,
          });
          return NextResponse.json(
            {
              success: false,
              error: `Escrow not locked and auto-escrow failed: ${escrowResult.error}. Please lock escrow manually before releasing.`,
              code: "AUTO_ESCROW_FAILED",
            },
            { status: 400 },
          );
        }

        logger.info(
          "[Release] Auto-escrow succeeded — continuing with release",
          {
            orderId: id,
            autoTxHash,
            newOrderVersion: escrowResult.order?.order_version,
          },
        );

        // Re-fetch the order after auto-escrow to get updated state
        const refreshedOrder = await getOrderWithRelations(id);
        if (!refreshedOrder || !refreshedOrder.escrow_debited_entity_id) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Auto-escrow completed but order state is inconsistent. Please retry.",
            },
            { status: 500 },
          );
        }
        // Replace order reference for subsequent checks
        Object.assign(order, refreshedOrder);
      } else {
        logger.warn("[Release] Rejected — escrow not locked", {
          orderId: id,
          actorId: actor_id,
          actorType: actor_type,
          orderStatus: order.status,
          escrowTxHash: order.escrow_tx_hash ?? null,
          escrowDebitedEntityId: order.escrow_debited_entity_id ?? null,
          escrowedAt: order.escrowed_at ?? null,
          callerIsSeller,
          autoEscrowEligible: autoEscrowEligibleStatuses.includes(order.status),
        });
        return NextResponse.json(
          {
            success: false,
            error:
              "Escrow not locked. Please complete the escrow step before releasing funds.",
            code: "ESCROW_NOT_LOCKED",
            details: {
              orderId: id,
              currentStatus: order.status,
              escrowTxHash: order.escrow_tx_hash ?? null,
              hint: "The seller must lock crypto in escrow before release can proceed.",
            },
          },
          { status: 400 },
        );
      }
    }

    // TASK 2: Only allow release from payment_sent, payment_confirmed, or releasing
    // payment_sent is allowed because the seller's "Confirm Payment" action
    // combines confirm + release into a single step (no separate payment_confirmed transition needed).
    const allowedReleaseStatuses = [
      "payment_sent",
      "payment_confirmed",
      "releasing",
    ];
    if (!allowedReleaseStatuses.includes(order.status)) {
      logger.warn("[Release] Rejected — invalid status for release", {
        orderId: id,
        currentStatus: order.status,
      });
      return NextResponse.json(
        {
          success: false,
          error: `Cannot release from status '${order.status}'. Payment must be sent first.`,
        },
        { status: 400 },
      );
    }

    // Double safety: payment_sent_at timestamp MUST exist
    if (!order.payment_sent_at) {
      logger.error(
        "[Release] Rejected — payment_sent_at is NULL despite valid status",
        {
          orderId: id,
          currentStatus: order.status,
        },
      );
      return NextResponse.json(
        {
          success: false,
          error: "Payment has not been marked as sent",
          code: "PAYMENT_TIMESTAMP_MISSING",
        },
        { status: 400 },
      );
    }

    // TASK 1: Only the seller or system can trigger release
    // The seller is whoever locked escrow (escrow_debited_entity_id).
    // For buy orders: merchant_id is the seller
    // For sell orders: user_id is the seller
    // For M2M (any type): merchant_id is ALWAYS the seller
    const isSystem = actor_type === "system";
    const isEscrowLocker =
      order.escrow_debited_entity_id &&
      actor_id === order.escrow_debited_entity_id;
    const isSeller = isEscrowLocker;
    if (!isSystem && !isSeller) {
      logger.warn("[Release] Rejected — actor is not seller or system", {
        orderId: id,
        actorId: actor_id,
        actorType: actor_type,
        merchantId: order.merchant_id,
        escrowDebitedEntityId: order.escrow_debited_entity_id,
        buyerMerchantId: order.buyer_merchant_id,
      });
      return forbiddenResponse("Only the seller or system can release escrow");
    }

    // TASK 11: Escrow integrity check before completion
    if (
      order.escrow_debited_entity_id !== order.merchant_id &&
      order.escrow_debited_entity_id !== order.user_id
    ) {
      logger.error(
        "[Release] Escrow integrity failure — debited entity is not a participant",
        {
          orderId: id,
          escrowDebitedEntityId: order.escrow_debited_entity_id,
          merchantId: order.merchant_id,
          userId: order.user_id,
        },
      );
      return NextResponse.json(
        {
          success: false,
          error: "Escrow integrity check failed — debited entity mismatch",
        },
        { status: 500 },
      );
    }

    // All pre-flight checks passed — log the release attempt
    logger.info("[Escrow:Release] All checks passed, executing release", {
      orderId: id,
      actorId: actor_id,
      actorType: actor_type,
      sellerId: order.merchant_id,
      escrowDebitedEntityId: order.escrow_debited_entity_id,
      deductedAmount: order.escrow_debited_amount,
      cryptoCurrency: order.crypto_currency,
      orderStatus: order.status,
      txHash: tx_hash,
    });

    // Enforce idempotency for release
    const idempotencyKey = getIdempotencyKey(request);
    const idempotencyResult = await withIdempotency(
      idempotencyKey,
      "release_escrow",
      id,
      async () => {
        // TASK 3: Pass real actor_type and actor_id — do NOT override to system
        const releaseResponse = await proxyCoreApi(`/v1/orders/${id}/events`, {
          method: "POST",
          body: { event_type: "release", tx_hash },
          actorType: actor_type,
          actorId: actor_id,
        });

        const responseData = await releaseResponse.json();
        return { data: responseData, statusCode: releaseResponse.status };
      },
    );

    if (idempotencyResult.cached) {
      logger.info("[Escrow:Release] Returning cached idempotent result", {
        orderId: id,
        key: idempotencyKey,
      });
    } else {
      const releaseSuccess = idempotencyResult.statusCode < 400;
      if (releaseSuccess) {
        auditLog('escrow.released', actor_id, actor_type, id, {
          deductedAmount: order.escrow_debited_amount,
          txHash: tx_hash,
        });
      }
      logger.info(`[Escrow:Release] ${releaseSuccess ? "Success" : "Failed"}`, {
        orderId: id,
        actorId: actor_id,
        sellerId: order.merchant_id,
        deductedAmount: order.escrow_debited_amount,
        httpStatus: idempotencyResult.statusCode,
        success: releaseSuccess,
      });
    }

    return NextResponse.json(idempotencyResult.data, {
      status: idempotencyResult.statusCode,
    });
  } catch (error) {
    logger.api.error("PATCH", "/api/orders/[id]/escrow", error as Error);
    return errorResponse("Internal server error");
  }
}
