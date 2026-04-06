import { NextRequest, NextResponse } from "next/server";
import { getOrderWithRelations } from "@/lib/db/repositories/orders";
import { logger, normalizeStatus } from "settlement-core";
import { updateOrderStatusSchema, uuidSchema } from "@/lib/validation/schemas";
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
import { proxyCoreApi, signActorHeaders } from "@/lib/proxy/coreApi";
import { serializeOrder } from "@/lib/api/orderSerializer";
import { getIdempotencyKey, withIdempotency } from "@/lib/idempotency";
import {
  handleOrderAction,
  resolveTradeRole,
  type OrderAction,
} from "@/lib/orders/handleOrderAction";
import { normalizeStatus as normalizeToMinimal } from "@/lib/orders/statusNormalizer";
import { enrichOrderResponse } from "@/lib/orders/enrichOrderResponse";
import { auditLog } from "@/lib/auditLog";

// Prevent Next.js from caching this route
export const dynamic = "force-dynamic";

// Validate order ID parameter
async function validateOrderId(
  id: string,
): Promise<{ valid: boolean; error?: string }> {
  const result = uuidSchema.safeParse(id);
  if (!result.success) {
    return { valid: false, error: "Invalid order ID format" };
  }
  return { valid: true };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = await validateOrderId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    // Require authenticated user
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // NOTE: GET always uses local query (read-only) because core-api
    // doesn't return joined merchant/user/offer objects needed by the UI.
    // Core-api proxy is used only for mutations (PATCH).
    // If _fresh param present, bypass cache for immediate consistency after mutations
    const wantsFresh = request.nextUrl.searchParams.has('_fresh');
    if (wantsFresh) {
      const { invalidateOrderCache } = await import('@/lib/cache/cacheService');
      await invalidateOrderCache(id);
    }
    // Fetch order
    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse("Order");
    }

    // Resolve merchant identity: when x-merchant-id header is present,
    // the caller may be acting as a merchant (M2M buyer).
    // Only trust the header if the authenticated actor is already a merchant.
    const getMerchantId = request.headers.get("x-merchant-id");
    if (getMerchantId && auth.actorType === "merchant") {
      auth.merchantId = getMerchantId;
    }

    // Check authorization
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      logger.auth.forbidden(
        `GET /api/orders/${id}`,
        auth.actorId,
        "Not order participant",
      );
      return forbiddenResponse("You do not have access to this order");
    }

    // Resolve actor ID: prefer merchant header for merchant callers
    const actorId = getMerchantId || auth.actorId;

    // Enrich order with backend-driven UI fields (my_role, primaryAction, secondaryAction)
    const uiFields = enrichOrderResponse(order, actorId);

    const enrichedOrder = {
      ...order,
      minimal_status: normalizeStatus(order.status),
      ...uiFields,
    };

    logger.api.request("GET", `/api/orders/${id}`, auth?.actorId);
    return successResponse(enrichedOrder);
  } catch (error) {
    logger.api.error("GET", "/api/orders/[id]", error as Error);
    return errorResponse("Internal server error");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = await validateOrderId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    const body = await request.json();

    // Require authentication
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Validate request body
    const parseResult = updateOrderStatusSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(
        (e) => `${e.path.join(".")}: ${e.message}`,
      );
      return validationErrorResponse(errors);
    }

    const {
      status,
      actor_type,
      actor_id,
      reason,
      acceptor_wallet_address,
      refund_tx_hash,
    } = parseResult.data;

    // Phase 3: Require token auth for sensitive financial transitions
    const sensitiveStatuses = ["payment_sent", "completed", "cancelled"];
    if (sensitiveStatuses.includes(status)) {
      const tokenAuth = await requireTokenAuth(request);
      if (tokenAuth instanceof NextResponse) return tokenAuth;
    }

    // Security: enforce actor matches authenticated identity
    // When both user+merchant headers are present and the route is /api/orders (not /merchant),
    // auth defaults to user. But a merchant acting (e.g. sending fiat, confirming payment)
    // uses actor_type='merchant' + their merchant ID.
    // Allow if actor_id matches either the resolved auth or the merchant header.
    const headerMerchantId = request.headers.get("x-merchant-id");
    const actorMatchesAuth = actor_id === auth.actorId;
    const actorMatchesMerchantHeader =
      actor_type === "merchant" &&
      auth.actorType === "merchant" &&
      headerMerchantId &&
      actor_id === headerMerchantId;
    if (!actorMatchesAuth && !actorMatchesMerchantHeader) {
      return forbiddenResponse(
        "actor_id does not match authenticated identity",
      );
    }
    // If merchant is acting, override auth context so canAccessOrder checks
    // the merchant identity (covers both User↔Merchant and M2M trades)
    if (!actorMatchesAuth && actorMatchesMerchantHeader) {
      auth.actorType = "merchant";
      auth.actorId = headerMerchantId;
      auth.merchantId = headerMerchantId;
    }

    // Verify access to this order (now with correct actor identity resolved above)
    // For claim transitions: skip canAccessOrder (merchant isn't assigned yet),
    // but verify the order is actually unclaimed to prevent hijacking.
    const isClaimTransition = ["accepted", "payment_pending", "payment_sent"].includes(body.status);
    if (isClaimTransition) {
      // Validate the order is claimable — don't skip auth entirely
      const { query: checkQuery } = await import("@/lib/db");
      const [targetOrder] = await checkQuery<{ merchant_id: string | null; buyer_merchant_id: string | null; status: string }>(
        `SELECT merchant_id, buyer_merchant_id, status FROM orders WHERE id = $1`,
        [id]
      );
      if (!targetOrder) return notFoundResponse("Order");
      // Block if already assigned to a DIFFERENT merchant
      const assignedMerchant = targetOrder.buyer_merchant_id || targetOrder.merchant_id;
      if (assignedMerchant && assignedMerchant !== auth.actorId) {
        return forbiddenResponse("Order already assigned to another merchant");
      }
    } else {
      const canAccess = await canAccessOrder(auth, id);
      if (!canAccess) {
        logger.auth.forbidden(
          `PATCH /api/orders/${id}`,
          auth.actorId,
          "Not order participant",
        );
        return forbiddenResponse("You do not have access to this order");
      }
    }

    // ── Acquire row-level lock for claim/financial actions to prevent race conditions ──
    const isActualClaim = ["accepted", "payment_pending"].includes(body.status);
    const needsLock = isActualClaim || ["payment_sent", "completed", "cancelled"].includes(status);
    if (needsLock) {
      const { query: lockQuery } = await import("@/lib/db");
      const lockResult = await lockQuery(
        `SELECT id FROM orders WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!lockResult || lockResult.length === 0) {
        return notFoundResponse("Order");
      }
    }

    // ── Fetch order once for all validation checks below ──
    // This single query replaces 4 separate getOrderWithRelations(id) calls
    // that previously hit the same 7-table JOIN for self-accept, role validation,
    // previousStatus, and escrow checks.
    let prefetchedOrder = await getOrderWithRelations(id);

    // Self-accept guard: prevent same wallet from creating and accepting an order.
    // Only applies to actual claiming actions (accepted/payment_pending),
    // NOT to payment_sent — the order creator IS the buyer in BUY orders
    // and must be allowed to mark their own payment as sent.
    if (isActualClaim && prefetchedOrder) {
      try {
        const creatorUserId = prefetchedOrder.user_id;
        const headerUserId = request.headers.get("x-user-id");
        if (
          creatorUserId &&
          (creatorUserId === actor_id ||
            creatorUserId === headerUserId ||
            creatorUserId === auth.userId)
        ) {
          return NextResponse.json(
            { success: false, error: "You cannot accept your own order" },
            { status: 400 },
          );
        }
      } catch (e) {
        logger.warn("[PATCH /orders] Self-accept check failed", {
          orderId: id,
          error: e,
        });
      }
    }

    // ── ROLE + STATUS VALIDATION (prevents bypass of action-based controls) ──
    // Map the raw status to an action so we can reuse handleOrderAction's
    // role + state machine validation. This closes the exploit where a buyer
    // could call PATCH { status: 'payment_confirmed' } or a seller could
    // call PATCH { status: 'payment_sent' } directly.
    const STATUS_TO_ACTION: Record<string, OrderAction> = {
      accepted: "ACCEPT",
      escrowed: "LOCK_ESCROW",
      payment_sent: "SEND_PAYMENT",
      payment_pending: "SEND_PAYMENT",
      payment_confirmed: "CONFIRM_PAYMENT",
      releasing: "CONFIRM_PAYMENT",
      completed: "CONFIRM_PAYMENT",
      cancelled: "CANCEL",
      disputed: "DISPUTE",
    };

    const mappedAction = STATUS_TO_ACTION[status];
    if (mappedAction) {
      if (!prefetchedOrder) {
        return notFoundResponse("Order");
      }

      const validation = handleOrderAction(
        prefetchedOrder,
        mappedAction,
        actor_id,
      );
      if (!validation.success) {
        logger.warn("[PATCH /orders] Role+status validation rejected", {
          orderId: id,
          targetStatus: status,
          mappedAction,
          actorId: actor_id,
          error: validation.error,
          code: validation.code,
        });
        return NextResponse.json(
          { success: false, error: validation.error, code: validation.code },
          { status: 403 },
        );
      }
    }

    // Use prefetched order for previousStatus (no separate query needed)
    const previousStatus: string | undefined = prefetchedOrder?.status;

    // Flow integrity: payment_sent and payment_confirmed require escrow to be locked.
    // Without escrow, these statuses are meaningless — the trade has no locked funds.
    const escrowRequiredStatuses = ["payment_sent", "payment_confirmed"];
    if (escrowRequiredStatuses.includes(status)) {
      const orderForCheck = prefetchedOrder;
      if (orderForCheck && !orderForCheck.escrow_debited_entity_id) {
        // If the order is in 'escrowed' status, escrow IS locked — backfill the missing field
        // to satisfy the DB constraint chk_escrow_required_for_payment_statuses.
        // Seller determination depends on order type and M2M status.
        if (orderForCheck.status === "escrowed" && orderForCheck.merchant_id) {
          const { query: dbQuery } = await import("@/lib/db");
          await dbQuery(
            `UPDATE orders
             SET escrow_debited_entity_id = COALESCE(escrow_debited_entity_id,
                   CASE
                     WHEN buyer_merchant_id IS NOT NULL THEN merchant_id
                     WHEN type = 'sell' THEN user_id
                     ELSE merchant_id
                   END),
                 escrow_debited_entity_type = COALESCE(escrow_debited_entity_type,
                   CASE WHEN type = 'sell' AND buyer_merchant_id IS NULL THEN 'user' ELSE 'merchant' END),
                 escrow_debited_amount = COALESCE(escrow_debited_amount, crypto_amount),
                 escrow_debited_at = COALESCE(escrow_debited_at, escrowed_at, created_at)
             WHERE id = $1 AND escrow_debited_entity_id IS NULL`,
            [id],
          );
          logger.info("[PATCH /orders] Backfilled escrow_debited_entity_id", {
            orderId: id,
            merchantId: orderForCheck.merchant_id,
          });
        } else {
          logger.warn(
            "[PATCH /orders] Rejected — escrow not locked for payment transition",
            {
              orderId: id,
              targetStatus: status,
              currentStatus: orderForCheck.status,
              escrowDebitedEntityId:
                orderForCheck.escrow_debited_entity_id ?? null,
            },
          );
          return NextResponse.json(
            {
              success: false,
              error: `Cannot transition to '${status}': escrow has not been locked. The seller must lock escrow first.`,
              code: "ESCROW_REQUIRED",
            },
            { status: 400 },
          );
        }
      }
    }

    // If refund_tx_hash provided, save it to DB regardless of mode
    if (refund_tx_hash) {
      const { query } = await import("@/lib/db");
      await query(
        `UPDATE orders SET refund_tx_hash = $1 WHERE id = $2 AND status NOT IN ('completed', 'cancelled', 'expired')`,
        [refund_tx_hash, id],
      );
      logger.info("[PATCH /orders] Saved refund_tx_hash", {
        orderId: id,
        refund_tx_hash,
      });
    }

    // TASK 10: Enforce idempotency for financial status transitions
    const financialStatuses = ["payment_sent", "completed", "cancelled"];
    const isFinancialTransition = financialStatuses.includes(status);
    const idempotencyKey = getIdempotencyKey(request);

    if (isFinancialTransition && !idempotencyKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Idempotency-Key header is required for financial transitions (payment_sent, completed, cancelled)",
          code: "MISSING_IDEMPOTENCY_KEY",
        },
        { status: 400 },
      );
    }

    if (isFinancialTransition && idempotencyKey) {
      const idempotencyResult = await withIdempotency(
        idempotencyKey,
        status === "payment_sent"
          ? "payment_sent"
          : status === "cancelled"
            ? "cancel_order"
            : "complete_order",
        id,
        async () => {
          const resp = await proxyCoreApi(`/v1/orders/${id}`, {
            method: "PATCH",
            body: {
              status,
              actor_type,
              actor_id,
              reason,
              acceptor_wallet_address,
            },
          });
          const respData = await resp.json();
          return { data: respData, statusCode: resp.status };
        },
      );
      if (idempotencyResult.cached) {
        logger.info("[PATCH /orders] Returning cached idempotent result", {
          orderId: id,
          status,
          key: idempotencyKey,
        });
      }
      return NextResponse.json(idempotencyResult.data, {
        status: idempotencyResult.statusCode,
      });
    }

    // Non-financial transitions: forward directly without idempotency
    const response = await proxyCoreApi(`/v1/orders/${id}`, {
      method: "PATCH",
      body: { status, actor_type, actor_id, reason, acceptor_wallet_address },
    });

    if (response.status < 400) {
      const action = status === 'cancelled' ? 'order.cancelled' as const : 'order.status_changed' as const;
      auditLog(action, actor_id, actor_type, id, {
        newStatus: status,
        previousStatus: prefetchedOrder?.status,
        reason,
      });
    }

    // Pusher notifications are now triggered by Core API directly
    return response;
  } catch (error) {
    logger.api.error("PATCH", "/api/orders/[id]", error as Error);
    return errorResponse("Internal server error");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = await validateOrderId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    // Require authentication
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Get params from query string
    const searchParams = request.nextUrl.searchParams;
    const actorType = searchParams.get("actor_type");
    const actorId = searchParams.get("actor_id");
    const reason = searchParams.get("reason");

    // Security: enforce actor matches authenticated identity
    // Allow if actor_id matches either the resolved auth or the merchant header
    const headerMerchantId = request.headers.get("x-merchant-id");
    const actorMatchesAuth = !actorId || actorId === auth.actorId;
    const actorMatchesMerchantHeader =
      actorType === "merchant" &&
      headerMerchantId &&
      actorId === headerMerchantId;
    if (!actorMatchesAuth && !actorMatchesMerchantHeader) {
      return forbiddenResponse(
        "actor_id does not match authenticated identity",
      );
    }

    const effectiveActorId = actorId || auth.actorId;
    const effectiveActorType = actorType || auth.actorType;

    const queryStr = `actor_type=${effectiveActorType}&actor_id=${effectiveActorId}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`;
    return proxyCoreApi(`/v1/orders/${id}?${queryStr}`, { method: "DELETE" });
  } catch (error) {
    logger.api.error("DELETE", "/api/orders/[id]", error as Error);
    return errorResponse("Internal server error");
  }
}
