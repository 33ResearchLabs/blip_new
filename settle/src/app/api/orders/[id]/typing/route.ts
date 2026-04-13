import { NextRequest } from 'next/server';
import { getOrderById } from '@/lib/db/repositories/orders';
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
import { z } from 'zod';
import { notifyTyping } from '@/lib/pusher/server';

// Request body schema
const typingSchema = z.object({
  actor_type: z.enum(['user', 'merchant', 'compliance']),
  is_typing: z.boolean(),
});

// Validate order ID parameter
async function validateOrderId(id: string): Promise<{ valid: boolean; error?: string }> {
  const result = uuidSchema.safeParse(id);
  if (!result.success) {
    return { valid: false, error: 'Invalid order ID format' };
  }
  return { valid: true };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = await validateOrderId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    const body = await request.json();

    // Validate request body
    const parseResult = typingSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { actor_type, is_typing } = parseResult.data;

    // Require proper authentication (not a manual fake auth check)
    const auth = await requireAuth(request);
    if (auth instanceof (await import('next/server')).NextResponse) return auth;

    // Check order exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Authorization: use the real authenticated actor
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    // Don't send typing indicators on terminal orders
    const terminalStatuses = ['completed', 'cancelled', 'expired'];
    if (terminalStatuses.includes(order.status)) {
      return successResponse({ sent: false, reason: 'Order is closed' });
    }

    // Trigger real-time typing notification (pass actorId for M2M support)
    await notifyTyping(id, actor_type, is_typing, auth.actorId);

    return successResponse({ sent: true });
  } catch (error) {
    console.error('Typing indicator error:', error);
    return errorResponse('Internal server error');
  }
}
