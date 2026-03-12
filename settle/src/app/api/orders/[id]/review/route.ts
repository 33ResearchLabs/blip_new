import { NextRequest, NextResponse } from 'next/server';
import { getReviewByOrderId, createReview } from '@/lib/db/repositories/reviews';
import { getOrderById } from '@/lib/db/repositories/orders';
import {
  submitReviewSchema,
  uuidSchema,
} from '@/lib/validation/schemas';
import {
  requireAuth,
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
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      logger.auth.forbidden(`GET /api/orders/${id}/review`, auth.actorId, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    const review = await getReviewByOrderId(id);

    if (!review) {
      return notFoundResponse('Review');
    }

    logger.api.request('GET', `/api/orders/${id}/review`, auth.actorId);
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

    // Require authentication first — prevents spoofed actor_id in body
    const auth = await requireAuth(request, body);
    if (auth instanceof NextResponse) return auth;

    // Validate request body
    const parseResult = submitReviewSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { reviewer_type, reviewer_id, reviewee_type, reviewee_id, rating, comment } = parseResult.data;

    // Verify the authenticated actor matches the reviewer
    if (auth.actorId !== reviewer_id) {
      return forbiddenResponse('Authenticated identity does not match reviewer_id');
    }

    // Check order exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Authorization: verify reviewer is a participant in this order
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      logger.auth.forbidden(`POST /api/orders/${id}/review`, reviewer_id, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    // Only allow reviews on completed orders
    if (order.status !== 'completed') {
      return validationErrorResponse(['Reviews can only be submitted for completed orders']);
    }

    // Verify the reviewer is reviewing the correct party
    // Users review merchants, merchants review users (or counterparty merchant in M2M)
    const isMerchantBuyer = order.buyer_merchant_id && reviewer_id === order.buyer_merchant_id;
    const isMerchantSeller = reviewer_id === order.merchant_id;

    if (reviewer_type === 'user') {
      if (reviewer_id !== order.user_id) {
        return forbiddenResponse('You can only submit reviews for your own orders');
      }
      if (reviewee_type !== 'merchant' || reviewee_id !== order.merchant_id) {
        return validationErrorResponse(['Users can only review the merchant of this order']);
      }
    } else if (reviewer_type === 'merchant') {
      // Merchant can be either seller (merchant_id) or buyer (buyer_merchant_id) in M2M
      if (!isMerchantSeller && !isMerchantBuyer) {
        return forbiddenResponse('You can only submit reviews for your own orders');
      }
      // M2M: merchant reviews the counterparty merchant
      if (isMerchantBuyer && order.buyer_merchant_id) {
        // I'm the buyer merchant, I should review the seller merchant
        if (reviewee_type !== 'merchant' || reviewee_id !== order.merchant_id) {
          return validationErrorResponse(['As buyer merchant, you can only review the seller merchant']);
        }
      } else if (isMerchantSeller && order.buyer_merchant_id) {
        // I'm the seller merchant in M2M, I should review the buyer merchant
        if (reviewee_type !== 'merchant' || reviewee_id !== order.buyer_merchant_id) {
          return validationErrorResponse(['As seller merchant, you can only review the buyer merchant']);
        }
      } else {
        // Non-M2M: merchant reviews the user
        if (reviewee_type !== 'user' || reviewee_id !== order.user_id) {
          return validationErrorResponse(['Merchants can only review the user of this order']);
        }
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
