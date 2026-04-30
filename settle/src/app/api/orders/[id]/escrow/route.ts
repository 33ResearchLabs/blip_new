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
import { query as dbQuery } from "@/lib/db";
import { getConnection } from "@/lib/solana/escrow";
import { verifyEscrowTx } from "@/lib/solana/verifyEscrowTx";

// Schema for escrow deposit.
//
// `tx_hash` is bounded to base58 signature length to defang silly inputs
// before we spend an RPC call. Actual cryptographic validation happens in
// verifyEscrowTx.
const escrowDepositSchema = z.object({
  tx_hash: z
    .string()
    .min(87, "Transaction hash too short")
    .max(88, "Transaction hash too long")
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "Transaction hash must be base58"),
  actor_type: z.enum(["user", "merchant"]),
  actor_id: z.string().uuid(),
  escrow_address: z.string().nullish(),
  // On-chain escrow references. escrow_trade_pda is now REQUIRED for
  // server-side verification (we need it to derive the vault ATA).
  escrow_trade_id: z.number().nullish(),
  escrow_trade_pda: z.string().min(32).max(44),
  escrow_pda: z.string().nullish(),
  escrow_creator_wallet: z.string().min(32).max(44),
});

const SOLANA_NETWORK: "devnet" | "mainnet-beta" =
  process.env.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet-beta"
    ? "mainnet-beta"
    : "devnet";

// Schema for escrow release. Same base58-signature shape guard as the
// lock route above. Without this, an earlier bug in the UI fabricated
// `server-release-fallback-<timestamp>` strings here, which the backend
// then stored as `release_tx_hash` and flipped `status -> completed`
// even though no on-chain release_escrow ever ran — leaving funds
// stranded in the vault. Enforcing the base58 signature shape here
// makes that ghost-release impossible by construction, regardless of
// what callers (current UI, old UIs, future UIs, direct API hits) try
// to submit.
const escrowReleaseSchema = z.object({
  tx_hash: z
    .string()
    .min(87, "Transaction hash too short — must be a base58 Solana signature")
    .max(88, "Transaction hash too long — must be a base58 Solana signature")
    .regex(
      /^[1-9A-HJ-NP-Za-km-z]+$/,
      "Transaction hash must be base58 — fabricated placeholders (e.g. 'server-release-fallback-*') are rejected",
    ),
  actor_type: z.enum(["user", "merchant"]),
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
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

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

    // Security: enforce actor matches authenticated identity (JWT only).
    // No more x-merchant-id swap — that header was the impersonation channel.
    if (parseResult.data.actor_id !== auth.actorId) {
      return forbiddenResponse(
        "actor_id does not match authenticated identity",
      );
    }
    if (parseResult.data.actor_type === "merchant" && auth.actorType !== "merchant") {
      return forbiddenResponse(
        "actor_type='merchant' requires a merchant token",
      );
    }

    // Verify access to this order (after auth context is resolved)
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse("You do not have access to this order");
    }

    // Fetch order FRESH from DB (skip cache — merchant_id may have just been set by accept)
    // NOTE: No row-level lock here — core-api's escrow_order_v1 handles atomicity
    // via SELECT FOR UPDATE inside the stored procedure.
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
      // Idempotent re-submission path. Two valid cases:
      //   (a) Client retried the SAME tx_hash — return current state (200).
      //   (b) Client submitted a DIFFERENT tx_hash against an already-
      //       escrowed order — reject (409). This blocks replay of an
      //       unrelated on-chain transfer onto an order that's already
      //       been accounted for, and would otherwise bypass the partial
      //       UNIQUE(escrow_tx_hash) index (since the column is already
      //       set for this order).
      const existing = depositOrder.escrow_tx_hash as string | null;
      if (existing && existing !== parseResult.data.tx_hash) {
        logger.warn(
          "[Escrow:Deposit] Rejected — order already escrowed with a different tx_hash",
          { orderId: id, existing, submitted: parseResult.data.tx_hash },
        );
        return NextResponse.json(
          {
            success: false,
            error: "Order already has an escrow transaction recorded.",
            code: "ESCROW_ALREADY_RECORDED",
          },
          { status: 409 },
        );
      }

      // Same tx_hash (or none previously recorded because of an older
      // flow). No status change; simply return the serialized order.
      logger.info("[Escrow:Deposit] Idempotent hit on already-escrowed order", {
        orderId: id,
        txHash: parseResult.data.tx_hash,
      });
      return successResponse(depositOrder);
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

    // ── CROSS-ORDER REPLAY GUARD ──
    // The partial UNIQUE index on orders.escrow_tx_hash (migration 065)
    // would reject a duplicate at commit time, but we want a clean 409
    // response and no wasted core-api work. Check explicitly up front.
    const collisionRows = await dbQuery<{ id: string }>(
      `SELECT id FROM orders WHERE escrow_tx_hash = $1 AND id <> $2 LIMIT 1`,
      [parseResult.data.tx_hash, id],
    );
    if (collisionRows.length > 0) {
      logger.warn("[Escrow:Deposit] Rejected — tx_hash already bound to another order", {
        orderId: id,
        collisionOrderId: collisionRows[0].id,
        txHash: parseResult.data.tx_hash,
      });
      return NextResponse.json(
        {
          success: false,
          error: "This transaction is already associated with a different order.",
          code: "TX_HASH_REUSED",
        },
        { status: 409 },
      );
    }

    // ── PDA BINDING VERIFICATION ──
    // Re-derive the canonical trade + escrow PDAs from
    // (creator_wallet, trade_id) and refuse any submitted PDA that
    // doesn't match. This MUST happen before verifyEscrowTx — otherwise
    // a malicious client could point us at someone else's on-chain
    // trade account that happens to have the right amount in it, and
    // the deposit would be recorded against this order.
    const { verifyEscrowPdaBinding } = await import('@/lib/solana/v2/verifyPdaBinding');
    const pdaBinding = verifyEscrowPdaBinding({
      orderId: id,
      creatorWallet: parseResult.data.escrow_creator_wallet,
      tradeId: parseResult.data.escrow_trade_id ?? null,
      submittedTradePda: parseResult.data.escrow_trade_pda,
      submittedEscrowPda: parseResult.data.escrow_pda ?? null,
    });
    if (!pdaBinding.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Escrow PDA binding rejected: ${pdaBinding.reason}`,
          code: 'ESCROW_PDA_MISMATCH',
          field: pdaBinding.field ?? null,
        },
        { status: 400 },
      );
    }
    // Replace client-submitted PDAs with the canonical derived values.
    // verifyEscrowTx and the proxied core-api call both consume these.
    parseResult.data.escrow_trade_pda = pdaBinding.derived.tradePda;
    parseResult.data.escrow_pda = pdaBinding.derived.escrowPda;

    // ── ON-CHAIN VERIFICATION ──
    // Fail closed: until we've confirmed the tx exists on-chain, is
    // successful, invoked the Blip V2 program, and actually deposited the
    // expected USDT amount into the expected trade vault ATA, we do NOT
    // record escrow. The backend must never take the client's word for it.
    const connection = getConnection(SOLANA_NETWORK);
    const verification = await verifyEscrowTx(connection, {
      txHash: parseResult.data.tx_hash,
      tradePda: parseResult.data.escrow_trade_pda,
      expectedAmount: depositOrder.crypto_amount as number,
      currency: (depositOrder.crypto_currency as string) || "USDT",
      network: SOLANA_NETWORK,
      creatorWallet: parseResult.data.escrow_creator_wallet,
    });

    if (!verification.ok) {
      // Distinguish transient ("try again in a moment") from permanent
      // ("this tx will never be valid for this order") failures so the
      // client can behave accordingly.
      const transient =
        verification.code === "TX_NOT_CONFIRMED" ||
        verification.code === "RPC_ERROR";
      const status = transient ? 425 : 400;

      logger.warn("[Escrow:Deposit] On-chain verification failed", {
        orderId: id,
        txHash: parseResult.data.tx_hash,
        code: verification.code,
        detail: verification.detail,
        transient,
      });

      return NextResponse.json(
        {
          success: false,
          error: transient
            ? "Transaction not yet confirmed on-chain. Please retry."
            : "Submitted transaction does not match this order's expected escrow.",
          code: verification.code,
          detail: verification.detail,
        },
        { status },
      );
    }

    logger.info("[Escrow:Deposit] On-chain verification passed", {
      orderId: id,
      txHash: parseResult.data.tx_hash,
      slot: verification.slot,
      vaultAta: verification.vaultAta,
      rawAmount: verification.observedRawAmount.toString(),
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

    // Security: enforce actor matches authenticated identity (JWT only).
    if (actor_id !== auth.actorId) {
      return forbiddenResponse(
        "actor_id does not match authenticated identity",
      );
    }
    if (actor_type === "merchant" && auth.actorType !== "merchant") {
      return forbiddenResponse(
        "actor_type='merchant' requires a merchant token",
      );
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

    // TASK 1: Only the seller can trigger release via API
    // The seller is whoever locked escrow (escrow_debited_entity_id).
    // System-level releases are internal only (not exposed via this API).
    const isEscrowLocker =
      order.escrow_debited_entity_id &&
      actor_id === order.escrow_debited_entity_id;
    if (!isEscrowLocker) {
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

    // ── Defense-in-depth: re-verify buyer wallet ownership at release ──
    // Even with checks at order creation and SEND_PAYMENT, a wallet that
    // slipped through (legacy order from before the ownership guard, or
    // a row tampered with via a future bug) must not direct funds to a
    // wallet the buyer doesn't own. Recompute the buyer's verified
    // wallet now and compare to the stored payout destination.
    //
    // Buyer is whichever party is NOT the escrow funder (= seller).
    //   BUY (U2M)   buyer = user_id
    //   SELL (U2M)  buyer = merchant_id
    //   M2M         buyer = buyer_merchant_id
    {
      const { query: dbQ } = await import("@/lib/db");
      const sellerId = order.escrow_debited_entity_id;
      let buyerType: "user" | "merchant" | null = null;
      let buyerId: string | null = null;
      if (order.buyer_merchant_id && sellerId === order.merchant_id) {
        buyerType = "merchant";
        buyerId = order.buyer_merchant_id;
      } else if (sellerId === order.merchant_id) {
        buyerType = "user";
        buyerId = order.user_id;
      } else if (sellerId === order.user_id) {
        buyerType = "merchant";
        buyerId = order.merchant_id;
      }

      const storedPayoutWallet =
        order.acceptor_wallet_address || order.buyer_wallet_address || null;

      if (buyerId && buyerType && storedPayoutWallet) {
        const tbl = buyerType === "merchant" ? "merchants" : "users";
        const buyerRows = await dbQ<{ wallet_address: string | null }>(
          `SELECT wallet_address FROM ${tbl} WHERE id = $1`,
          [buyerId],
        );
        const buyerVerifiedWallet = buyerRows[0]?.wallet_address ?? null;

        if (
          !buyerVerifiedWallet ||
          buyerVerifiedWallet !== storedPayoutWallet
        ) {
          const strict = process.env.WALLET_OWNERSHIP_STRICT === "true";
          if (strict) {
            logger.error(
              "[security][wallet_inject] Release blocked — stored payout wallet does not match buyer's verified wallet",
              {
                orderId: id,
                buyerType,
                buyerId,
                storedPayoutWallet,
                buyerVerifiedWallet,
              },
            );
            return NextResponse.json(
              {
                success: false,
                error:
                  "Buyer wallet ownership cannot be verified at release. Manual review required.",
                code: "WALLET_OWNERSHIP_RELEASE_BLOCK",
              },
              { status: 422 },
            );
          }
          logger.warn(
            "[security][wallet_inject] Release proceeding despite buyer wallet mismatch (lax mode)",
            {
              orderId: id,
              buyerType,
              buyerId,
              storedPayoutWallet,
              buyerVerifiedWallet,
            },
          );
        }
      }
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
