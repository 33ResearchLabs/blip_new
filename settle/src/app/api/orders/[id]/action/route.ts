/**
 * POST /api/orders/:id/action
 *
 * Action-based order mutation endpoint. The frontend sends an ACTION
 * (ACCEPT, LOCK_ESCROW, SEND_PAYMENT, CONFIRM_PAYMENT, CANCEL, DISPUTE),
 * and the backend resolves, validates, and executes the transition atomically.
 *
 * The frontend NEVER sends a target status — only an action intent.
 * The backend is the single source of truth for all status transitions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrderWithRelations, claimOrder, claimAndPayOrder } from '@/lib/db/repositories/orders';
import { logger } from 'settlement-core';
import { uuidSchema } from '@/lib/validation/schemas';
import {
  requireAuth,
  requireTokenAuth,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import { getIdempotencyKey, withIdempotency } from '@/lib/idempotency';
import { mockEscrowLock } from '@/lib/money/escrowLock';
import { atomicCancelWithRefund } from '@/lib/orders/atomicCancel';
import {
  handleOrderAction,
  resolveTradeRole,
  resolveRoles,
  getAllowedActions,
  ORDER_ACTIONS,
  type OrderAction,
} from '@/lib/orders/handleOrderAction';
import { denormalizeStatus, normalizeStatus } from '@/lib/orders/statusNormalizer';
import { guardOrderClaim, guardPaymentRetry } from '@/lib/guards';
import { fireInstantNotification } from '@/lib/notifications/instantNotify';
import { invalidateOrderCache, updateOrderCache, invalidateMerchantOrderListCache } from '@/lib/cache';
import { enrichOrderResponse } from '@/lib/orders/enrichOrderResponse';

export const dynamic = 'force-dynamic';

// ── Request schema ─────────────────────────────────────────────────────

const orderActionSchema = z.object({
  action: z.enum(ORDER_ACTIONS as unknown as [string, ...string[]]),
  actor_id: uuidSchema,
  actor_type: z.enum(['user', 'merchant']),
  // Optional fields for specific actions
  reason: z.string().max(500).nullish(),                   // CANCEL reason
  tx_hash: z.string().min(1).nullish(),                    // LOCK_ESCROW tx hash
  acceptor_wallet_address: z.string().nullish(),           // ACCEPT/CLAIM wallet
  acceptor_wallet_signature: z.string().max(256).nullish(),// Option B: signature
                                                            //   over `${Action} order ${orderId} - ... Wallet: ${addr}`
  escrow_trade_id: z.number().nullish(),                   // On-chain escrow refs
  escrow_trade_pda: z.string().nullish(),
  escrow_pda: z.string().nullish(),
  escrow_creator_wallet: z.string().nullish(),
});

// ── POST handler ───────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Validate order ID format
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const parseResult = orderActionSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const {
      action,
      actor_id,
      actor_type,
      reason,
      tx_hash,
      acceptor_wallet_address,
      acceptor_wallet_signature,
      escrow_trade_id,
      escrow_trade_pda,
      escrow_pda,
      escrow_creator_wallet,
    } = parseResult.data;

    // 3. Authenticate — use strict token auth for financial actions
    const sensitiveActions = ['SEND_PAYMENT', 'CONFIRM_PAYMENT', 'CANCEL', 'LOCK_ESCROW'];
    const isSensitive = sensitiveActions.includes(action);
    const auth = isSensitive
      ? await requireTokenAuth(request)
      : await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // 4. Security: enforce actor matches authenticated identity.
    // Identity is taken ONLY from the cryptographically-signed JWT
    // (auth.actorId / auth.actorType). The previous header-based "actor
    // swap" allowed any merchant to claim any other merchant's id.
    const { assertActorMatchesAuth } = await import('@/lib/middleware/merchantIdentity');
    const actorMismatch = assertActorMatchesAuth(auth, { actor_id, actor_type });
    if (actorMismatch) return actorMismatch;

    // 5. Fetch order
    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // 6. Access check (skip for ACCEPT/SEND_FIAT — observer is joining/claiming)
    const isClaimingOrder = ['ACCEPT', 'SEND_FIAT', 'CLAIM'].includes(action);
    if (!isClaimingOrder) {
      const canAccess = await canAccessOrder(auth, id);
      if (!canAccess) {
        logger.auth.forbidden(`POST /api/orders/${id}/action`, auth.actorId, 'Not order participant');
        return forbiddenResponse('You do not have access to this order');
      }
    }

    // 6b. Wallet-injection guard.
    //
    // Any action that supplies `acceptor_wallet_address` causes that wallet
    // to flow into the order row and ultimately into the on-chain release
    // destination. The caller MUST own that wallet — either it matches
    // their authenticated wallet (Option A) or they sign the canonical
    // binding message and submit it as `acceptor_wallet_signature` (Option B).
    //
    // During rollout (WALLET_OWNERSHIP_STRICT=false) a mismatch is allowed
    // through with a `[security][wallet_inject]` warn-log so legacy
    // clients don't break. Strict mode promotes the same case to a 403.
    if (acceptor_wallet_address) {
      const { assertWalletOwnership } = await import('@/lib/auth/walletOwnership');
      const sigAction: 'Claim' | 'Confirm' =
        action === 'CLAIM' || action === 'ACCEPT' ? 'Claim' : 'Confirm';
      const ownership = await assertWalletOwnership({
        auth,
        walletAddress: acceptor_wallet_address,
        orderId: id,
        signature: acceptor_wallet_signature ?? null,
        signatureAction: sigAction,
      });
      if (!ownership.ok) {
        return forbiddenResponse(
          `acceptor_wallet_address ownership not verified: ${ownership.reason ?? 'unknown'}`
        );
      }
    }

    // 7. Run handleOrderAction — the core validation
    const result = handleOrderAction(order, action as OrderAction, actor_id);

    if (!result.success) {
      logger.warn('[Action] Rejected', {
        orderId: id,
        action,
        actorId: actor_id,
        error: result.error,
        code: result.code,
        currentStatus: order.status,
      });

      // Include current_state (minimal 8-state) + allowed_actions so the
      // frontend can recover gracefully (show the right buttons instead of
      // guessing). Wrapped in try/catch — enrichment failure must never mask
      // the original error.
      let currentState: string = order.status;
      let allowedActions: string[] = [];
      try {
        currentState = normalizeStatus(order.status as any);
        allowedActions = getAllowedActions(order, actor_id);
      } catch { /* swallow — don't break primary error response */ }

      return NextResponse.json(
        {
          success: false,
          error: result.error,
          code: result.code,
          current_state: currentState,
          allowed_actions: allowedActions,
        },
        { status: 400 }
      );
    }

    const targetStatus = result.targetStatus!;
    const dbTargetStatus = denormalizeStatus(targetStatus);

    logger.info('[Action] Validated, executing', {
      orderId: id,
      action,
      actorId: actor_id,
      currentStatus: order.status,
      targetStatus,
      dbTargetStatus,
    });

    // 8. Execute the action — delegate to specialized handlers for complex actions

    // ── LOCK_ESCROW: atomic balance deduction + status update ──
    if (action === 'LOCK_ESCROW') {
      const escrowTxHash = tx_hash || `mock-escrow-${id}-${Date.now()}`;

      // Server-side PDA binding verification. Re-derive the canonical
      // tradePda + escrowPda from (creator_wallet, trade_id) and refuse
      // any submitted PDA that doesn't match. The DERIVED values are
      // stored — never the client-submitted attestations.
      const { verifyEscrowPdaBinding, rejectsSubmittedPdaWithoutDerivationInputs } =
        await import('@/lib/solana/v2/verifyPdaBinding');

      const earlyReject = rejectsSubmittedPdaWithoutDerivationInputs({
        creatorWallet: escrow_creator_wallet ?? null,
        tradeId: escrow_trade_id ?? null,
        submittedTradePda: escrow_trade_pda ?? null,
        submittedEscrowPda: escrow_pda ?? null,
      });
      if (earlyReject && !earlyReject.ok) {
        return NextResponse.json(
          { success: false, error: earlyReject.reason, code: 'ESCROW_PDA_UNVERIFIABLE' },
          { status: 400 }
        );
      }

      // If any escrow on-chain reference was provided, the full quartet
      // must be present and consistent. The verifier handles all the
      // cross-checks and emits the structured security log on mismatch.
      let derivedTradePda: string | undefined;
      let derivedEscrowPda: string | undefined;
      const anyEscrowFieldProvided =
        !!escrow_creator_wallet ||
        (escrow_trade_id !== null && escrow_trade_id !== undefined) ||
        !!escrow_trade_pda ||
        !!escrow_pda;
      if (anyEscrowFieldProvided) {
        const verify = verifyEscrowPdaBinding({
          orderId: id,
          creatorWallet: escrow_creator_wallet ?? null,
          tradeId: escrow_trade_id ?? null,
          submittedTradePda: escrow_trade_pda ?? null,
          submittedEscrowPda: escrow_pda ?? null,
        });
        if (!verify.ok) {
          return NextResponse.json(
            {
              success: false,
              error: `Escrow PDA binding rejected: ${verify.reason}`,
              code: 'ESCROW_PDA_MISMATCH',
              field: verify.field ?? null,
            },
            { status: 400 }
          );
        }
        derivedTradePda = verify.derived.tradePda;
        derivedEscrowPda = verify.derived.escrowPda;
      }

      const escrowResult = await mockEscrowLock(
        id,
        actor_type,
        actor_id,
        escrowTxHash,
        {
          escrow_trade_id: escrow_trade_id ?? undefined,
          // Always store the SERVER-DERIVED PDAs, never the client-submitted ones.
          escrow_trade_pda: derivedTradePda ?? (escrow_trade_pda ?? undefined),
          escrow_pda: derivedEscrowPda ?? (escrow_pda ?? undefined),
          escrow_creator_wallet: escrow_creator_wallet ?? undefined,
        }
      );

      if (!escrowResult.success) {
        return NextResponse.json(
          { success: false, error: escrowResult.error, code: 'ESCROW_LOCK_FAILED' },
          { status: 400 }
        );
      }

      // Instant notification for escrow lock
      fireInstantNotification({
        orderId: id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        buyerMerchantId: order.buyer_merchant_id ?? undefined,
        status: 'escrowed',
        previousStatus: order.status,
        orderVersion: escrowResult.order?.order_version,
        updatedAt: new Date().toISOString(),
        data: escrowResult.order,
      });
      // Write-through: update cache with fresh data instead of invalidating
      if (escrowResult.order) { updateOrderCache(id, escrowResult.order); invalidateMerchantOrderListCache(order.merchant_id); }
      else { invalidateOrderCache(id); invalidateMerchantOrderListCache(order.merchant_id); }

      const enrichedEscrow = escrowResult.order
        ? enrichOrderResponse(escrowResult.order, actor_id)
        : undefined;
      return successResponse({
        order: escrowResult.order,
        action,
        previousStatus: order.status,
        newStatus: 'escrowed',
        ...enrichedEscrow,
      });
    }

    // ── CANCEL: atomic cancel with escrow refund ──
    if (action === 'CANCEL') {
      const cancelResult = await atomicCancelWithRefund(
        id,
        order.status,
        actor_type,
        actor_id,
        reason || undefined
      );

      if (!cancelResult.success) {
        return NextResponse.json(
          { success: false, error: cancelResult.error, code: 'CANCEL_FAILED' },
          { status: 400 }
        );
      }

      // Instant notification for cancellation
      fireInstantNotification({
        orderId: id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        buyerMerchantId: order.buyer_merchant_id ?? undefined,
        status: 'cancelled',
        previousStatus: order.status,
        orderVersion: cancelResult.order?.order_version,
        updatedAt: new Date().toISOString(),
        data: cancelResult.order,
      });
      if (cancelResult.order) { updateOrderCache(id, cancelResult.order); invalidateMerchantOrderListCache(order.merchant_id); }
      else { invalidateOrderCache(id); invalidateMerchantOrderListCache(order.merchant_id); }

      const enrichedCancel = cancelResult.order
        ? enrichOrderResponse(cancelResult.order, actor_id)
        : undefined;
      return successResponse({
        order: cancelResult.order,
        action,
        previousStatus: order.status,
        newStatus: 'cancelled',
        ...enrichedCancel,
      });
    }

    // ── CONFIRM_PAYMENT: confirm + release escrow (two-step atomic via core-api) ──
    if (action === 'CONFIRM_PAYMENT') {
      // Auto-key uses a 30-second time window so genuine double-clicks (within seconds)
      // collapse to ONE execution and return the cached result, while genuine retries
      // after the window naturally generate a fresh key. Explicit Idempotency-Key
      // header from client always takes precedence.
      const window30s = Math.floor(Date.now() / 30000);
      const idempotencyKey = getIdempotencyKey(request) || `${id}:confirm:${actor_id}:${window30s}`;

      const idempotencyResult = await withIdempotency(
        idempotencyKey,
        'confirm_and_complete',
        id,
        async () => {
          // First confirm payment, then core-api handles release + completion
          const resp = await proxyCoreApi(`/v1/orders/${id}`, {
            method: 'PATCH',
            body: {
              status: 'payment_confirmed',
              actor_type,
              actor_id,
            },
          });
          const respData = await resp.json();
          return { data: respData, statusCode: resp.status };
        }
      );

      if (idempotencyResult.cached) {
        logger.info('[Action] Returning cached CONFIRM_PAYMENT result', { orderId: id });
      }

      // Instant notification — fire immediately so UI sees completion without waiting for outbox poll
      let enrichedConfirm: Record<string, unknown> | undefined;
      if (idempotencyResult.statusCode >= 200 && idempotencyResult.statusCode < 300) {
        const respOrder = idempotencyResult.data?.order || idempotencyResult.data;
        fireInstantNotification({
          orderId: id,
          userId: order.user_id,
          merchantId: order.merchant_id,
          buyerMerchantId: order.buyer_merchant_id ?? undefined,
          status: 'completed',
          previousStatus: order.status,
          orderVersion: respOrder?.order_version,
          updatedAt: new Date().toISOString(),
          data: respOrder,
        });
        // Write-through cache update
        if (respOrder) { updateOrderCache(id, respOrder); invalidateMerchantOrderListCache(order.merchant_id); }
        else { invalidateOrderCache(id); invalidateMerchantOrderListCache(order.merchant_id); }

        // Safe enrichment — never throws. If respOrder is incomplete or
        // enrichment errors, response falls back to original shape (zero
        // regression). Spread BEFORE idempotencyResult.data so core-api
        // fields always take precedence on any field collision.
        try {
          if (respOrder?.id && respOrder?.status && respOrder?.type) {
            enrichedConfirm = enrichOrderResponse(respOrder, actor_id) as unknown as Record<string, unknown>;
          }
        } catch (enrichErr) {
          logger.warn('[Action] Enrichment failed for CONFIRM_PAYMENT (non-fatal)', {
            orderId: id,
            error: enrichErr instanceof Error ? enrichErr.message : String(enrichErr),
          });
        }
      }

      return NextResponse.json(
        {
          ...(enrichedConfirm ?? {}),
          ...idempotencyResult.data,
          action,
          previousStatus: order.status,
        },
        { status: idempotencyResult.statusCode }
      );
    }

    // ── CLAIM: atomic claim of an escrowed order (broadcast model) ──
    if (action === 'CLAIM') {
      guardOrderClaim(id, actor_id);
      const claimResult = await claimOrder(
        id,
        actor_id,
        acceptor_wallet_address || undefined,
      );

      if (!claimResult.success) {
        return NextResponse.json(
          { success: false, error: claimResult.error, code: 'CLAIM_FAILED' },
          { status: 409 } // Conflict — likely already claimed
        );
      }

      // Instant notification for claim (status stays escrowed, only buyer_merchant_id set)
      fireInstantNotification({
        orderId: id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        buyerMerchantId: actor_id,
        status: 'escrowed',
        previousStatus: order.status,
        orderVersion: claimResult.order?.order_version,
        updatedAt: new Date().toISOString(),
        data: claimResult.order,
      });
      if (claimResult.order) { updateOrderCache(id, claimResult.order); invalidateMerchantOrderListCache(order.merchant_id); }
      else { invalidateOrderCache(id); invalidateMerchantOrderListCache(order.merchant_id); }

      const enrichedClaim = claimResult.order
        ? enrichOrderResponse(claimResult.order, actor_id)
        : undefined;
      return successResponse({
        order: claimResult.order,
        action,
        previousStatus: order.status,
        newStatus: 'escrowed',
        ...enrichedClaim,
      });
    }

    // ── SEND_PAYMENT on unclaimed escrowed order: auto-claim + pay (Option B) ──
    // Only for truly unclaimed broadcast orders (merchant-created with placeholder user).
    // Skip if actor is already merchant_id — they're already assigned, just do normal SEND_PAYMENT.
    const isUnclaimed = !order.buyer_merchant_id && order.merchant_id !== actor_id;
    if (action === 'SEND_PAYMENT' && order.status === 'escrowed' && isUnclaimed) {
      guardOrderClaim(id, actor_id);
      guardPaymentRetry(id, 'SEND_PAYMENT', actor_id);
      // Merchant is trying to send payment on an unclaimed order — do atomic claim+pay
      const claimPayResult = await claimAndPayOrder(
        id,
        actor_id,
        acceptor_wallet_address || undefined,
      );

      if (!claimPayResult.success) {
        return NextResponse.json(
          { success: false, error: claimPayResult.error, code: 'CLAIM_AND_PAY_FAILED' },
          { status: 409 }
        );
      }

      // Instant notification
      fireInstantNotification({
        orderId: id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        buyerMerchantId: actor_id,
        status: 'payment_sent',
        previousStatus: order.status,
        orderVersion: claimPayResult.order?.order_version,
        updatedAt: new Date().toISOString(),
        data: claimPayResult.order,
      });
      if (claimPayResult.order) { updateOrderCache(id, claimPayResult.order); invalidateMerchantOrderListCache(order.merchant_id); }
      else { invalidateOrderCache(id); invalidateMerchantOrderListCache(order.merchant_id); }

      const enrichedClaimPay = claimPayResult.order
        ? enrichOrderResponse(claimPayResult.order, actor_id)
        : undefined;
      return successResponse({
        order: claimPayResult.order,
        action,
        previousStatus: order.status,
        newStatus: 'payment_sent',
        claimed: true,
        ...enrichedClaimPay,
      });
    }

    // ── Backfill escrow_debited_entity_id if missing on escrowed orders ──
    // The DB constraint chk_escrow_required_for_payment_statuses requires
    // escrow_debited_entity_id for payment_sent/completed. On-chain escrow
    // may not have set this field. Backfill using seller-determination logic.
    if (action === 'SEND_PAYMENT' && !order.escrow_debited_entity_id && order.merchant_id) {
      const { query: dbQuery } = await import('@/lib/db');
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
        [id]
      );
      logger.info('[Action] Backfilled escrow_debited_entity_id for SEND_PAYMENT', {
        orderId: id,
        merchantId: order.merchant_id,
      });
    }

    // ── Capture buyer's wallet address on SEND_PAYMENT ──
    // The buyer (who sends fiat) needs their wallet recorded so on-chain escrow
    // release sends USDT to the correct wallet. If the frontend sent it in the
    // request, update it. Otherwise, look up from merchants table.
    if (action === 'SEND_PAYMENT') {
      let buyerWallet = acceptor_wallet_address;
      if (!buyerWallet) {
        // Look up from merchants table
        const { query: dbQuery } = await import('@/lib/db');
        const walletResult = await dbQuery<{ wallet_address: string }>(
          'SELECT wallet_address FROM merchants WHERE id = $1',
          [actor_id]
        );
        buyerWallet = walletResult?.[0]?.wallet_address || null;
      }
      if (buyerWallet && buyerWallet !== order.acceptor_wallet_address) {
        const { query: dbQuery } = await import('@/lib/db');
        await dbQuery(
          'UPDATE orders SET acceptor_wallet_address = $1 WHERE id = $2',
          [buyerWallet, id]
        );
        logger.info('[Action] Updated acceptor_wallet_address for buyer on SEND_PAYMENT', {
          orderId: id,
          actorId: actor_id,
          wallet: buyerWallet,
        });
      }
    }

    // ── ACCEPT, SEND_PAYMENT, DISPUTE: standard status transitions via core-api ──
    const isFinancial = action === 'SEND_PAYMENT';
    const idempotencyKey = getIdempotencyKey(request);

    const executeTransition = async () => {
      const resp = await proxyCoreApi(`/v1/orders/${id}`, {
        method: 'PATCH',
        body: {
          status: dbTargetStatus,
          actor_type,
          actor_id,
          reason: action === 'DISPUTE' ? (reason || 'Dispute raised') : reason,
          acceptor_wallet_address: action === 'ACCEPT' ? acceptor_wallet_address : undefined,
          // For ACCEPT on unclaimed orders: assign the claiming merchant
          ...(action === 'ACCEPT' && !order.merchant_id && actor_type === 'merchant' ? { merchant_id: actor_id } : {}),
        },
      });
      const respData = await resp.json();
      return { data: respData, statusCode: resp.status };
    };

    if (isFinancial) {
      // 30-second time window — collapses double-clicks to one execution but
      // allows genuine retries after the window. Client-provided Idempotency-Key
      // (if present) overrides this.
      const window30s = Math.floor(Date.now() / 30000);
      const key = idempotencyKey || `${id}:${action}:${actor_id}:${window30s}`;
      const idempotencyResult = await withIdempotency(key, 'payment_sent', id, executeTransition);

      if (idempotencyResult.cached) {
        logger.info('[Action] Returning cached SEND_PAYMENT result', { orderId: id });
      }

      // Instant notification for SEND_PAYMENT
      let enrichedSendPayment: Record<string, unknown> | undefined;
      if (idempotencyResult.statusCode >= 200 && idempotencyResult.statusCode < 300) {
        const respOrder = idempotencyResult.data?.order || idempotencyResult.data;
        fireInstantNotification({
          orderId: id,
          userId: order.user_id,
          merchantId: order.merchant_id,
          buyerMerchantId: order.buyer_merchant_id ?? undefined,
          status: dbTargetStatus,
          previousStatus: order.status,
          orderVersion: respOrder?.order_version,
          updatedAt: new Date().toISOString(),
          data: respOrder,
        });
        if (respOrder) { updateOrderCache(id, respOrder); invalidateMerchantOrderListCache(order.merchant_id); }
        else { invalidateOrderCache(id); invalidateMerchantOrderListCache(order.merchant_id); }

        // Safe enrichment — see CONFIRM_PAYMENT for rationale. Falls back
        // to original shape if respOrder is incomplete or enrichment throws.
        try {
          if (respOrder?.id && respOrder?.status && respOrder?.type) {
            enrichedSendPayment = enrichOrderResponse(respOrder, actor_id) as unknown as Record<string, unknown>;
          }
        } catch (enrichErr) {
          logger.warn('[Action] Enrichment failed for SEND_PAYMENT (non-fatal)', {
            orderId: id,
            error: enrichErr instanceof Error ? enrichErr.message : String(enrichErr),
          });
        }
      }

      return NextResponse.json(
        {
          ...(enrichedSendPayment ?? {}),
          ...idempotencyResult.data,
          action,
          previousStatus: order.status,
        },
        { status: idempotencyResult.statusCode }
      );
    }

    // Non-financial: execute directly (ACCEPT, DISPUTE)
    const transitionResult = await executeTransition();

    // Instant notification for non-financial transitions
    let enrichedTransition: Record<string, unknown> | undefined;
    if (transitionResult.statusCode >= 200 && transitionResult.statusCode < 300) {
      const respOrder = transitionResult.data?.order || transitionResult.data;
      fireInstantNotification({
        orderId: id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        buyerMerchantId: order.buyer_merchant_id ?? undefined,
        status: dbTargetStatus,
        previousStatus: order.status,
        orderVersion: respOrder?.order_version,
        updatedAt: new Date().toISOString(),
        data: respOrder,
      });
      if (respOrder) { updateOrderCache(id, respOrder); invalidateMerchantOrderListCache(order.merchant_id); }
      else { invalidateOrderCache(id); invalidateMerchantOrderListCache(order.merchant_id); }

      // Safe enrichment — see CONFIRM_PAYMENT for rationale. Falls back
      // to original shape if respOrder is incomplete or enrichment throws.
      try {
        if (respOrder?.id && respOrder?.status && respOrder?.type) {
          enrichedTransition = enrichOrderResponse(respOrder, actor_id) as unknown as Record<string, unknown>;
        }
      } catch (enrichErr) {
        logger.warn('[Action] Enrichment failed for ACCEPT/DISPUTE (non-fatal)', {
          orderId: id,
          action,
          error: enrichErr instanceof Error ? enrichErr.message : String(enrichErr),
        });
      }
    }

    // Invalidate caches for ALL involved merchants (order creator + actor + buyer)
    if (auth.actorType === 'merchant' && auth.actorId !== order.merchant_id) {
      invalidateMerchantOrderListCache(auth.actorId);
    }
    if (order.buyer_merchant_id && order.buyer_merchant_id !== order.merchant_id) {
      invalidateMerchantOrderListCache(order.buyer_merchant_id);
    }

    return NextResponse.json(
      {
        ...(enrichedTransition ?? {}),
        ...transitionResult.data,
        action,
        previousStatus: order.status,
      },
      { status: transitionResult.statusCode }
    );
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/action', error as Error);
    return errorResponse('Internal server error');
  }
}

// ── GET: Return allowed actions for current user ───────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Determine actor ID from auth context (cryptographically-signed JWT).
    const actorId = auth.actorId;

    const allowedActions = getAllowedActions(order, actorId);
    const role = resolveTradeRole(order, actorId);
    const roles = resolveRoles(order);
    const uiFields = enrichOrderResponse(order, actorId);

    return successResponse({
      orderId: id,
      currentStatus: order.status,
      role,
      roles: {
        buyer_id: roles.buyer_id,
        seller_id: roles.seller_id,
      },
      allowedActions,
      ...uiFields,
    });
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/action', error as Error);
    return errorResponse('Internal server error');
  }
}
