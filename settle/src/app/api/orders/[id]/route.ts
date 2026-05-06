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
import { query as dbQuery } from "@/lib/db";

// Prevent Next.js from caching this route
export const dynamic = "force-dynamic";

// Persist timings to error_logs so we can read breakdown via SQL.
function recordTiming(type: string, orderId: string, totalMs: number, marks: Array<{ label: string; at: number }>): void {
  dbQuery(
    `INSERT INTO error_logs (type, message, severity, order_id, source, metadata)
     VALUES ($1, $2, 'INFO', $3, 'backend', $4::jsonb)`,
    [
      `timing.${type}`,
      `Timing ${type}: ${totalMs}ms`,
      orderId,
      JSON.stringify({ total_ms: totalMs, marks }),
    ]
  ).catch(() => {});
}

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

    // Identity comes from the JWT only. For merchant tokens, auth.merchantId
    // is already populated by getAuthContext from the same actorId. The
    // x-merchant-id header read here was redundant and a spoofing surface.

    // Check authorization. Pass the already-fetched `order` so canAccessOrder
    // doesn't issue a duplicate getOrderById — under pool starvation the
    // duplicate query was timing out, throwing inside canAccessOrder's
    // try/catch, and returning false → spurious 403 for legitimate participants.
    const canAccess = await canAccessOrder(auth, id, order);
    if (!canAccess) {
      logger.auth.forbidden(
        `GET /api/orders/${id}`,
        auth.actorId,
        "Not order participant",
      );
      return forbiddenResponse("You do not have access to this order");
    }

    // Resolve actor ID from cryptographically-signed JWT.
    const actorId = auth.actorId;

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
  const __t0 = Date.now();
  const __marks: Array<{ label: string; at: number }> = [];
  const __mark = (label: string) => __marks.push({ label, at: Date.now() - __t0 });
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = await validateOrderId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    const body = await request.json();
    __mark('parse');

    // Validate request body FIRST so we know which auth strength to require.
    // (Previously: requireAuth, then requireTokenAuth — duplicating session +
    // blacklist DB lookups, the same queries appearing as 7-22 second outliers
    // under load.)
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

    // Single auth call: pick the strength based on status (matches the
    // action route's pattern). Eliminates 2 redundant session/blacklist checks.
    const sensitiveStatuses = ["payment_sent", "completed", "cancelled"];
    const isSensitive = sensitiveStatuses.includes(status);
    const auth = isSensitive
      ? await requireTokenAuth(request)
      : await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    __mark('auth');

    // Security: enforce actor matches authenticated identity.
    // Identity comes ONLY from the JWT — the x-merchant-id header swap
    // pattern was the impersonation channel that this fix closes.
    const actorMatchesAuth = actor_id === auth.actorId;
    if (!actorMatchesAuth) {
      return forbiddenResponse(
        "actor_id does not match authenticated identity",
      );
    }
    // No header-based actor swap — the JWT IS the merchant identity.

    // ── (formerly) Acquire row-level lock for claim/financial actions ──
    // The previous SELECT FOR UPDATE outside a transaction was a NO-OP:
    // pg's autocommit released the lock immediately after the single statement.
    // Core-api's stored procs already do FOR UPDATE atomically with the mutation,
    // so removing this useless round-trip costs nothing.

    // ── Fetch order once for all validation + access checks below ──
    // Reordered: prefetch happens BEFORE access check so canAccessOrder
    // can reuse the same row (saves a duplicate SELECT). Also lets the
    // claim-transition path use the same row instead of issuing its own
    // small SELECT.
    const isClaimTransition = ["accepted", "payment_pending"].includes(body.status);
    const isActualClaim = isClaimTransition;
    const prefetchedOrder = await getOrderWithRelations(id);
    __mark('prefetch_order');

    // Verify access to this order. For claim transitions, validate the order
    // is claimable instead of running the participant check (acceptor isn't
    // assigned yet).
    if (isClaimTransition) {
      if (!prefetchedOrder) return notFoundResponse("Order");
      // Anti-hijack: only block when there's no claimable slot left for the actor.
      //
      // Shapes:
      //   M2M SELL broadcast: merchant_id=creator(seller), bmerch=null  → open slot = buyer
      //   M2M BUY  broadcast: merchant_id=null,           bmerch=creator → open slot = seller
      //   Fully claimed M2M:  both set with different merchants → no slot for a third party
      //   U2M / pre-assigned: merchant_id set, bmerch=null (handled by updateOrderStatus
      //                       which reassigns merchant_id on isMerchantClaiming=true)
      const buyerFilledByOther =
        !!prefetchedOrder.buyer_merchant_id && prefetchedOrder.buyer_merchant_id !== auth.actorId;
      const sellerFilledByOther =
        !!prefetchedOrder.merchant_id && prefetchedOrder.merchant_id !== auth.actorId;
      if (buyerFilledByOther && sellerFilledByOther) {
        return forbiddenResponse("Order already assigned to another merchant");
      }
    } else {
      const canAccess = await canAccessOrder(auth, id, prefetchedOrder);
      if (!canAccess) {
        logger.auth.forbidden(
          `PATCH /api/orders/${id}`,
          auth.actorId,
          "Not order participant",
        );
        return forbiddenResponse("You do not have access to this order");
      }
    }
    __mark('access_check');

    // Self-accept guard: prevent same wallet from creating and accepting an order.
    // Only applies to actual claiming actions (accepted/payment_pending),
    // NOT to payment_sent — the order creator IS the buyer in BUY orders
    // and must be allowed to mark their own payment as sent.
    if (isActualClaim && prefetchedOrder) {
      try {
        const creatorUserId = prefetchedOrder.user_id;
        // x-user-id header dropped — auth.userId is the JWT-bound identity
        if (
          creatorUserId &&
          (creatorUserId === actor_id || creatorUserId === auth.userId)
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
      await dbQuery(
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
            // Forward the SAME key — core-api requires it for these
            // status transitions (payment_sent / cancel_order /
            // release_escrow path).
            idempotencyKey,
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
      __mark('proxy_core_api');
      const __finTotal = Date.now() - __t0;
      logger.info(`[Timing] PATCH.${status}`, { orderId: id, total_ms: __finTotal, marks: __marks });
      recordTiming(`PATCH.${status}`, id, __finTotal, __marks);
      return NextResponse.json(idempotencyResult.data, {
        status: idempotencyResult.statusCode,
      });
    }

    // Non-financial transitions: forward directly without idempotency
    const response = await proxyCoreApi(`/v1/orders/${id}`, {
      method: "PATCH",
      body: { status, actor_type, actor_id, reason, acceptor_wallet_address },
    });
    __mark('proxy_core_api');

    if (response.status < 400) {
      const action = status === 'cancelled' ? 'order.cancelled' as const : 'order.status_changed' as const;
      auditLog(action, actor_id, actor_type, id, {
        newStatus: status,
        previousStatus: prefetchedOrder?.status,
        reason,
      });
    }

    const __nfTotal = Date.now() - __t0;
    logger.info(`[Timing] PATCH.${status}`, { orderId: id, total_ms: __nfTotal, marks: __marks });
    recordTiming(`PATCH.${status}`, id, __nfTotal, __marks);

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

    // Security: enforce actor matches authenticated identity (JWT only).
    if (actorId && actorId !== auth.actorId) {
      return forbiddenResponse(
        "actor_id does not match authenticated identity",
      );
    }
    if (actorType && actorType !== auth.actorType) {
      return forbiddenResponse(
        `actor_type does not match authenticated identity (${auth.actorType})`,
      );
    }

    const effectiveActorId = actorId || auth.actorId;
    const effectiveActorType = actorType || auth.actorType;

    // Idempotency-Key required by core-api's withIdempotency wrapper on
    // cancel_order. Reject upfront with 400 so the caller sees a clear
    // error instead of an opaque core-api proxy failure.
    const idempotencyKey = getIdempotencyKey(request);
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Idempotency-Key header is required to cancel an order. " +
            "Send a unique value (UUIDv4 recommended) per logical request.",
          code: "MISSING_IDEMPOTENCY_KEY",
        },
        { status: 400 },
      );
    }

    const queryStr = `actor_type=${effectiveActorType}&actor_id=${effectiveActorId}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`;
    return proxyCoreApi(`/v1/orders/${id}?${queryStr}`, {
      method: "DELETE",
      idempotencyKey,
    });
  } catch (error) {
    logger.api.error("DELETE", "/api/orders/[id]", error as Error);
    return errorResponse("Internal server error");
  }
}
