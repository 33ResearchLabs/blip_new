import { NextRequest, NextResponse } from 'next/server';
import { getOrderWithRelations } from '@/lib/db/repositories/orders';
import { logger } from 'settlement-core';
import { uuidSchema } from '@/lib/validation/schemas';
import {
  requireAuth,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';

/**
 * Pre-flight validation for escrow release.
 *
 * Returns { canRelease, reasons[] } so the frontend can gate the
 * release button and show actionable guidance BEFORE the user
 * attempts the on-chain release transaction.
 */
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

    const reasons: string[] = [];

    // 1. Escrow must be locked
    if (!order.escrow_debited_entity_id) {
      reasons.push('Escrow has not been locked. The seller must lock crypto in escrow first.');
    }

    // 2. Status must be payment_sent, payment_confirmed, or releasing
    const allowedStatuses = ['payment_sent', 'payment_confirmed', 'releasing'];
    if (!allowedStatuses.includes(order.status)) {
      reasons.push(
        `Order is in '${order.status}' status. Release is only allowed after payment is sent.`
      );
    }

    // 2b. payment_sent_at timestamp must exist (double safety)
    if (!(order as any).payment_sent_at) {
      reasons.push('Payment has not been marked as sent (missing payment_sent_at timestamp).');
    }

    // 3. Terminal state check
    const terminalStatuses = ['completed', 'cancelled', 'expired'];
    if (terminalStatuses.includes(order.status)) {
      reasons.push(`Order is already in terminal status '${order.status}'.`);
    }

    // 4. On-chain escrow details present (needed for actual release tx)
    if (!order.escrow_trade_id && !order.escrow_tx_hash) {
      reasons.push('Missing on-chain escrow details (trade ID / tx hash). Escrow may not have been recorded.');
    }

    // 5. Determine who the caller is relative to the order
    // Seller = whoever locked escrow (escrow_debited_entity_id) OR merchant_id
    const actorId = auth.merchantId || auth.actorId;
    const isEscrowLocker = order.escrow_debited_entity_id && actorId === order.escrow_debited_entity_id;
    const isMerchantSeller = actorId === order.merchant_id;
    const isSeller = isEscrowLocker || isMerchantSeller;
    const isSystem = auth.actorType === 'system';
    if (!isSeller && !isSystem) {
      reasons.push('Only the seller or system can release escrow.');
    }

    // 6. Integrity: escrow_debited_entity_id must be a participant
    if (
      order.escrow_debited_entity_id &&
      order.escrow_debited_entity_id !== order.merchant_id &&
      order.escrow_debited_entity_id !== order.user_id
    ) {
      reasons.push('Escrow integrity issue: debited entity is not a recognized participant.');
    }

    const canRelease = reasons.length === 0;

    logger.info('[ValidateRelease]', {
      orderId: id,
      canRelease,
      reasons,
      status: order.status,
      actorId,
    });

    return successResponse({
      canRelease,
      reasons,
      order: {
        id: order.id,
        status: order.status,
        escrow_locked: !!order.escrow_debited_entity_id,
        escrow_tx_hash: order.escrow_tx_hash ?? null,
        escrow_trade_id: order.escrow_trade_id ?? null,
      },
    });
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/validate-release', error as Error);
    return errorResponse('Internal server error');
  }
}
