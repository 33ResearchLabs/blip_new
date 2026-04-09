import { NextRequest, NextResponse } from 'next/server';
import { notifyDirectTyping, notifyTyping } from '@/lib/pusher/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';

// POST /api/merchant/direct-messages/typing
// Body: { contactType: 'user'|'merchant', contactId: string, isTyping: boolean }
// Sends a TYPING_START / TYPING_STOP event to the recipient's private channel.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
      return validationErrorResponse(['Only user or merchant can send typing events']);
    }

    const body = await request.json().catch(() => ({}));
    const { contactType, contactId, isTyping } = body || {};

    if (contactType !== 'user' && contactType !== 'merchant') {
      return validationErrorResponse(['Invalid contactType']);
    }
    if (!contactId || typeof contactId !== 'string') {
      return validationErrorResponse(['Missing contactId']);
    }

    await notifyDirectTyping(
      auth.actorType,
      auth.actorId,
      contactType,
      contactId,
      !!isTyping,
    );

    // ALSO fire order-channel typing for any active order between these two
    // parties, so the counterpart sees typing in their order chat view too.
    try {
      const senderType = auth.actorType;
      const senderId = auth.actorId;
      // Build a flexible WHERE clause that matches both party orderings.
      const rows = await query<{ id: string }>(
        `SELECT id FROM orders
         WHERE status NOT IN ('completed','cancelled','expired')
           AND (
             (user_id = $1 AND merchant_id = $2)
             OR (user_id = $2 AND merchant_id = $1)
             OR (merchant_id = $1 AND buyer_merchant_id = $2)
             OR (merchant_id = $2 AND buyer_merchant_id = $1)
           )
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 5`,
        [senderId, contactId]
      );
      await Promise.all(
        rows.map(r => notifyTyping(r.id, senderType as 'user' | 'merchant', !!isTyping).catch(() => {}))
      );
    } catch (err) {
      console.error('[direct-messages/typing] order-channel relay failed:', err);
    }

    return successResponse({ ok: true });
  } catch (error) {
    console.error('[direct-messages/typing] error:', error);
    return errorResponse('Internal server error');
  }
}
