import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import { requireAuth, canAccessOrder, forbiddenResponse } from '@/lib/middleware/auth';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';
import { validateFields } from '@/lib/middleware/validation';
import { getOrderWithRelations } from '@/lib/db/repositories/orders';
import { resolveTradeRole } from '@/lib/orders/handleOrderAction';
import { normalizeStatus } from '@/lib/orders/statusNormalizer';
import { logger } from 'settlement-core';

// Create a dispute for an order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit: 10 dispute operations per minute
  const rateLimitResponse = await checkRateLimit(request, 'dispute:create', STRICT_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: orderId } = await params;
    const body = await request.json();

    // Require authentication
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Resolve merchant identity from header (must happen BEFORE canAccessOrder)
    // Only trust header if the authenticated token is a merchant token
    const dispHeaderMerchantId = request.headers.get('x-merchant-id');
    if (dispHeaderMerchantId && auth.actorType === 'merchant' && !auth.merchantId) {
      auth.merchantId = dispHeaderMerchantId;
    }

    // Verify access to this order
    const canAccess = await canAccessOrder(auth, orderId);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    const { reason, description, initiated_by, user_id, merchant_id } = body;

    if (!reason) {
      return NextResponse.json(
        { success: false, error: 'Reason is required' },
        { status: 400 }
      );
    }

    const lengthError = validateFields([[reason, 'reason'], [description, 'description']]);
    if (lengthError) {
      return NextResponse.json({ success: false, error: lengthError }, { status: 400 });
    }

    if (!initiated_by || !['user', 'merchant'].includes(initiated_by)) {
      return NextResponse.json(
        { success: false, error: 'initiated_by must be user or merchant' },
        { status: 400 }
      );
    }

    const actorId = initiated_by === 'user'
      ? (user_id || '')
      : (merchant_id || '');

    // Security: enforce actor matches authenticated identity
    // Only allow merchant header fallback if authenticated as merchant
    if (actorId !== auth.actorId && !(initiated_by === 'merchant' && auth.actorType === 'merchant' && dispHeaderMerchantId && actorId === dispHeaderMerchantId)) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }

    // ── STATUS + ROLE VALIDATION ──
    // Disputes only allowed from escrowed or payment_sent, and only by buyer or seller
    const disputeOrder = await getOrderWithRelations(orderId);
    if (!disputeOrder) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    const minimalStatus = normalizeStatus(disputeOrder.status);
    const allowedDisputeStatuses = ['escrowed', 'payment_sent'];
    if (!allowedDisputeStatuses.includes(minimalStatus)) {
      logger.warn('[Dispute] Rejected — invalid status for dispute', {
        orderId,
        currentStatus: disputeOrder.status,
        minimalStatus,
      });
      return NextResponse.json(
        { success: false, error: `Cannot raise dispute from status '${minimalStatus}'. Disputes are only allowed when escrow is locked (escrowed or payment_sent).`, code: 'INVALID_STATUS_FOR_DISPUTE' },
        { status: 400 }
      );
    }

    const role = resolveTradeRole(disputeOrder, actorId);
    if (role !== 'buyer' && role !== 'seller') {
      logger.warn('[Dispute] Rejected — actor is not a participant', {
        orderId,
        actorId,
        resolvedRole: role,
      });
      return NextResponse.json(
        { success: false, error: 'Only the buyer or seller can raise a dispute.', code: 'NOT_PARTICIPANT' },
        { status: 403 }
      );
    }

    return proxyCoreApi(`/v1/orders/${orderId}/dispute`, {
      method: 'POST',
      body: { reason, description, initiated_by, actor_id: actorId },
    });
  } catch (error) {
    console.error('Failed to create dispute:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create dispute' },
      { status: 500 }
    );
  }
}

// Get dispute for an order (read-only, stays local)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id: orderId } = await params;

    const canAccess = await canAccessOrder(auth, orderId);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    const result = await query(
      `SELECT d.*, o.order_number, o.crypto_amount, o.fiat_amount
       FROM disputes d
       JOIN orders o ON d.order_id = o.id
       WHERE d.order_id = $1`,
      [orderId]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No dispute found for this order' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result[0],
    });
  } catch (error) {
    console.error('Failed to get dispute:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get dispute' },
      { status: 500 }
    );
  }
}
