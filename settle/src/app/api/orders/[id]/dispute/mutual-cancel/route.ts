import { NextRequest, NextResponse } from 'next/server';
import { query, transaction } from '@/lib/db';
import { requireAuth, requireApiKeyScope, canAccessOrder, forbiddenResponse } from '@/lib/middleware/auth';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';
import { getOrderWithRelations } from '@/lib/db/repositories/orders';
import { resolveTradeRole } from '@/lib/orders/handleOrderAction';
import { atomicFinalizeDispute } from '@/lib/orders/atomicFinalizeDispute';
import { logger } from 'settlement-core';

// POST /api/orders/[id]/dispute/mutual-cancel
// action: 'request' | 'withdraw'
// Both parties requesting cancel → immediately finalize as refund-to-seller.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = await checkRateLimit(request, 'dispute:create', STRICT_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: orderId } = await params;
    const body = await request.json();
    const { action, actor_type, actor_id } = body;

    if (!action || !['request', 'withdraw'].includes(action)) {
      return NextResponse.json(
        { success: false, error: "action must be 'request' or 'withdraw'" },
        { status: 400 }
      );
    }
    if (!actor_type || !['user', 'merchant'].includes(actor_type)) {
      return NextResponse.json(
        { success: false, error: "actor_type must be 'user' or 'merchant'" },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const scopeErr = requireApiKeyScope(auth, 'orders:write');
    if (scopeErr) return scopeErr;

    if (actor_id !== auth.actorId) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }
    if (actor_type === 'merchant' && auth.actorType !== 'merchant') {
      return forbiddenResponse("actor_type='merchant' requires a merchant token");
    }

    const canAccess = await canAccessOrder(auth, orderId);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    const order = await getOrderWithRelations(orderId);
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    if (order.status !== 'disputed') {
      return NextResponse.json(
        { success: false, error: 'Mutual cancel is only available for disputed orders' },
        { status: 400 }
      );
    }

    const role = resolveTradeRole(order, actor_id);
    if (role !== 'buyer' && role !== 'seller') {
      return NextResponse.json(
        { success: false, error: 'Only the buyer or seller can request mutual cancel' },
        { status: 403 }
      );
    }

    // Fetch existing dispute
    const disputeRows = await query(
      'SELECT * FROM disputes WHERE order_id = $1',
      [orderId]
    );
    if (disputeRows.length === 0) {
      return NextResponse.json({ success: false, error: 'No dispute found for this order' }, { status: 404 });
    }
    const dispute = disputeRows[0] as {
      mutual_cancel_requested_by_user: boolean;
      mutual_cancel_requested_by_merchant: boolean;
    };

    const isUser = actor_type === 'user';
    const userCol = isUser ? 'mutual_cancel_requested_by_user' : 'mutual_cancel_requested_by_merchant';
    const timeCol = isUser ? 'mutual_cancel_user_at' : 'mutual_cancel_merchant_at';
    const requesting = action === 'request';

    // Update this party's flag
    await query(
      `UPDATE disputes SET ${userCol} = $1, ${timeCol} = $2 WHERE order_id = $3`,
      [requesting, requesting ? new Date().toISOString() : null, orderId]
    );

    // Send a chat message about their action
    const chatContent = requesting
      ? JSON.stringify({ type: 'mutual_cancel_requested', by: actor_type })
      : JSON.stringify({ type: 'mutual_cancel_withdrawn', by: actor_type });

    await query(
      `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, created_at)
       VALUES ($1, 'system', $2, $3, 'system', NOW())`,
      [orderId, actor_id, chatContent]
    );

    // Check if both parties now agree
    const otherUserRequested = isUser
      ? dispute.mutual_cancel_requested_by_merchant
      : dispute.mutual_cancel_requested_by_user;

    const bothAgree = requesting && otherUserRequested;

    if (bothAgree) {
      logger.info('[MutualCancel] Both parties agreed — finalizing dispute as refund', { orderId });

      const result = await atomicFinalizeDispute({
        orderId,
        resolution: 'merchant', // refund to depositor (seller)
        complianceMember: {
          id: 'system',
          name: 'Mutual Agreement',
          role: 'system',
        },
        notes: 'Both buyer and seller mutually agreed to cancel the dispute.',
      });

      if (!result.success) {
        logger.error('[MutualCancel] atomicFinalizeDispute failed', { orderId, error: result.error });
        return NextResponse.json({ success: false, error: result.error }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        mutualCancelComplete: true,
        newStatus: result.newStatus,
        escrowAction: result.escrowAction,
        refundedTo: result.refundedTo,
      });
    }

    return NextResponse.json({
      success: true,
      mutualCancelComplete: false,
      yourRequest: requesting,
      waitingForCounterparty: requesting,
    });
  } catch (error) {
    logger.error('[MutualCancel] Failed', { error });
    return NextResponse.json({ success: false, error: 'Failed to process mutual cancel' }, { status: 500 });
  }
}

// GET — fetch current mutual cancel state for an order's dispute
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const scopeErr = requireApiKeyScope(auth, 'orders:read');
    if (scopeErr) return scopeErr;

    const canAccess = await canAccessOrder(auth, orderId);
    if (!canAccess) return forbiddenResponse('You do not have access to this order');

    const rows = await query(
      `SELECT mutual_cancel_requested_by_user, mutual_cancel_user_at,
              mutual_cancel_requested_by_merchant, mutual_cancel_merchant_at
       FROM disputes WHERE order_id = $1`,
      [orderId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: true, data: null });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to fetch mutual cancel state' }, { status: 500 });
  }
}
