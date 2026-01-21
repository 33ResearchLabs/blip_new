import { NextRequest } from 'next/server';
import { getOrderById } from '@/lib/db/repositories/orders';
import { uuidSchema } from '@/lib/validation/schemas';
import {
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
  actor_type: z.enum(['user', 'merchant']),
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

    // Check order exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Authorization: verify actor can access this order
    const actorId = actor_type === 'user' ? order.user_id : order.merchant_id;
    const auth = { actorType: actor_type, actorId };
    const canAccess = await canAccessOrder(auth as { actorType: 'user' | 'merchant' | 'system'; actorId: string }, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    // Don't send typing indicators on terminal orders
    const terminalStatuses = ['completed', 'cancelled', 'expired'];
    if (terminalStatuses.includes(order.status)) {
      return successResponse({ sent: false, reason: 'Order is closed' });
    }

    // Trigger real-time typing notification
    await notifyTyping(id, actor_type, is_typing);

    return successResponse({ sent: true });
  } catch (error) {
    console.error('Typing indicator error:', error);
    return errorResponse('Internal server error');
  }
}
