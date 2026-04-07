import { NextRequest } from 'next/server';
import { getOrderById } from '@/lib/db/repositories/orders';
import { query } from '@/lib/db';
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
    if (auth instanceof (await import('next/server')).NextResponse) return auth;

    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    // Presence is now handled by Pusher presence channels (presence-order-{id}).
    // This endpoint is a fallback — returns empty if chat_presence table doesn't exist.
    let members: { actorType: string; actorId: string; isOnline: boolean; lastSeen: string | null }[] = [];
    try {
      const presenceRows = await query<{
        actor_type: string;
        actor_id: string;
        is_online: boolean;
        last_seen: Date | null;
      }>(
        `SELECT cp.actor_type, cp.actor_id, cp.is_online, cp.last_seen
         FROM chat_presence cp
         WHERE (cp.actor_type = 'user' AND cp.actor_id = $1)
            OR (cp.actor_type = 'merchant' AND cp.actor_id = ANY($2::uuid[]))
            OR cp.actor_type = 'compliance'`,
        [
          order.user_id,
          [order.merchant_id, order.buyer_merchant_id].filter(Boolean),
        ]
      );
      members = presenceRows.map(row => ({
        actorType: row.actor_type,
        actorId: row.actor_id,
        isOnline: row.is_online,
        lastSeen: row.last_seen?.toISOString() || null,
      }));
    } catch {
      // Table may not exist — Pusher presence handles this instead
    }

    return successResponse({ orderId: id, members });
  } catch (error) {
    console.error('Presence query error:', error);
    return errorResponse('Internal server error');
  }
}
