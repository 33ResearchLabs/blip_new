import { NextRequest, NextResponse } from 'next/server';
import { getOrderById } from '@/lib/db/repositories/orders';
import { uuidSchema } from '@/lib/validation/schemas';
import {
  requireAuth,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
} from '@/lib/middleware/auth';
import { getChatAvailability, hasBothParties } from '@/lib/chat/availability';
import { logger } from '@/lib/logger';

/**
 * GET /api/orders/[id]/chat-status
 *
 * Returns the definitive chat availability state for this order.
 * The frontend must use this to decide whether to show/hide chat UI.
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     chat: {
 *       enabled: boolean,
 *       reason: string | null
 *     },
 *     bothPartiesJoined: boolean
 *   }
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const idResult = uuidSchema.safeParse(id);
    if (!idResult.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    const chatStatus = getChatAvailability(order, auth.actorType as 'user' | 'merchant' | 'compliance' | 'system');
    const bothPartiesJoined = hasBothParties(order);

    return successResponse({
      chat: {
        enabled: chatStatus.enabled,
        reason: chatStatus.reason,
      },
      bothPartiesJoined,
    });
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/chat-status', error as Error);
    return NextResponse.json(
      { success: false, error: 'Failed to get chat status' },
      { status: 500 }
    );
  }
}
