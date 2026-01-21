import { NextRequest, NextResponse } from 'next/server';
import { getReviewByOrderId, createReview } from '@/lib/db/repositories/reviews';
import { getOrderById } from '@/lib/db/repositories/orders';
import {
  submitReviewSchema,
  uuidSchema,
} from '@/lib/validation/schemas';
import {
  getAuthContext,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

// Validate order ID parameter
async function validateOrderId(id: string): Promise<{ valid: boolean; error?: string }> {
  const result = uuidSchema.safeParse(id);
  if (!result.success) {
    return { valid: false, error: 'Invalid order ID format' };
  }
  return { valid: true };
}

export async function GET(
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

    // Check order exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Authorization check
    const auth = getAuthContext(request);
    if (auth) {
      const canAccess = await canAccessOrder(auth, id);
      if (!canAccess) {
        logger.auth.forbidden(`GET /api/orders/${id}/review`, auth.actorId, 'Not order participant');
        return forbiddenResponse('You do not have access to this order');
      }
    }

    const review = await getReviewByOrderId(id);

    if (!review) {
      return notFoundResponse('Review');
    }

    logger.api.request('GET', `/api/orders/${id}/review`, auth?.actorId);
    return successResponse(review);
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/review', error as Error);
    return errorResponse('Internal server error');
  }
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
    const parseResult = submitReviewSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { reviewer_type, reviewer_id, reviewee_type, reviewee_id, rating, comment } = parseResult.data;

    // Check order exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Authorization: verify reviewer is a participant in this order
    const auth = { actorType: reviewer_type, actorId: reviewer_id };
    const canAccess = await canAccessOrder(auth as { actorType: 'user' | 'merchant' | 'system'; actorId: string }, id);
    if (!canAccess) {
      logger.auth.forbidden(`POST /api/orders/${id}/review`, reviewer_id, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    // Only allow reviews on completed orders
    if (order.status !== 'completed') {
      return validationErrorResponse(['Reviews can only be submitted for completed orders']);
    }

    // Verify the reviewer is reviewing the correct party
    // Users can only review merchants, merchants can only review users
    if (reviewer_type === 'user') {
      if (reviewer_id !== order.user_id) {
        return forbiddenResponse('You can only submit reviews for your own orders');
      }
      if (reviewee_type !== 'merchant' || reviewee_id !== order.merchant_id) {
        return validationErrorResponse(['Users can only review the merchant of this order']);
      }
    } else if (reviewer_type === 'merchant') {
      if (reviewer_id !== order.merchant_id) {
        return forbiddenResponse('You can only submit reviews for your own orders');
      }
      if (reviewee_type !== 'user' || reviewee_id !== order.user_id) {
        return validationErrorResponse(['Merchants can only review the user of this order']);
      }
    }

    // Check if review already exists
    const existingReview = await getReviewByOrderId(id);
    if (existingReview) {
      return NextResponse.json(
        { success: false, error: 'Review already exists for this order' },
        { status: 409 }
      );
    }

    const review = await createReview({
      order_id: id,
      reviewer_type,
      reviewer_id,
      reviewee_type,
      reviewee_id,
      rating,
      comment,
    });

    logger.info('Review submitted', {
      orderId: id,
      reviewerType: reviewer_type,
      reviewerId: reviewer_id,
      rating,
    });

    return successResponse(review, 201);
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/review', error as Error);
    return errorResponse('Internal server error');
  }
}
