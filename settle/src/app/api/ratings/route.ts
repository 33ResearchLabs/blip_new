import { NextRequest } from 'next/server';
import {
  createRating,
  getOrderRatingStatus,
  hasRated,
  getRatingsForEntity,
  getTopRatedSellers,
  getTopRatedUsers,
  getPendingRatingsForMerchant,
  getPendingRatingsForUser,
} from '@/lib/db/repositories/ratings';
import { queryOne } from '@/lib/db';
import {
  getAuthContext,
  validationErrorResponse,
  successResponse,
  errorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';

// GET /api/ratings - Get ratings or top rated lists
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type'); // 'top-sellers', 'top-users', 'for-entity', 'pending', 'status'
    const entityType = searchParams.get('entity_type') as 'merchant' | 'user' | null;
    const entityId = searchParams.get('entity_id');
    const orderId = searchParams.get('order_id');
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    if (type === 'top-sellers') {
      const sellers = await getTopRatedSellers(limit);
      return successResponse({ sellers });
    }

    if (type === 'top-users') {
      const users = await getTopRatedUsers(limit);
      return successResponse({ users });
    }

    if (type === 'for-entity' && entityType && entityId) {
      const ratings = await getRatingsForEntity(entityType, entityId, limit);
      return successResponse({ ratings });
    }

    if (type === 'pending') {
      if (!entityType || !entityId) {
        return validationErrorResponse(['entity_type and entity_id are required for pending ratings']);
      }

      // Authorization check
      const auth = getAuthContext(request);
      if (auth) {
        const isOwner = auth.actorType === entityType && auth.actorId === entityId;
        if (!isOwner && auth.actorType !== 'system') {
          return forbiddenResponse('You can only view your own pending ratings');
        }
      }

      if (entityType === 'merchant') {
        const pending = await getPendingRatingsForMerchant(entityId);
        return successResponse({ pending });
      } else {
        const pending = await getPendingRatingsForUser(entityId);
        return successResponse({ pending });
      }
    }

    if (type === 'status' && orderId) {
      const status = await getOrderRatingStatus(orderId);
      return successResponse({ status });
    }

    return validationErrorResponse(['Invalid query parameters']);
  } catch (error) {
    console.error('Error fetching ratings:', error);
    return errorResponse('Internal server error');
  }
}

// POST /api/ratings - Create a new rating
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { order_id, rater_type, rater_id, rating, review_text } = body;

    if (!order_id || !rater_type || !rater_id || !rating) {
      return validationErrorResponse(['order_id, rater_type, rater_id, and rating are required']);
    }

    if (rating < 1 || rating > 5) {
      return validationErrorResponse(['Rating must be between 1 and 5']);
    }

    // Authorization check
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === rater_type && auth.actorId === rater_id;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only submit ratings as yourself');
      }
    }

    // Check if already rated
    const alreadyRated = await hasRated(order_id, rater_type, rater_id);
    if (alreadyRated) {
      return validationErrorResponse(['You have already rated this order']);
    }

    // Get order details to determine who to rate
    const order = await queryOne<{
      id: string;
      user_id: string;
      merchant_id: string;
      buyer_merchant_id?: string;
      status: string;
    }>(
      `SELECT id, user_id, merchant_id, buyer_merchant_id, status FROM orders WHERE id = $1`,
      [order_id]
    );

    if (!order) {
      return validationErrorResponse(['Order not found']);
    }

    if (order.status !== 'completed') {
      return validationErrorResponse(['Can only rate completed orders']);
    }

    // Determine who is being rated
    let rated_type: 'merchant' | 'user';
    let rated_id: string;

    if (rater_type === 'merchant' && rater_id === order.merchant_id) {
      // Merchant is rating the counterparty
      if (order.buyer_merchant_id) {
        // M2M order - rate the other merchant
        rated_type = 'merchant';
        rated_id = order.buyer_merchant_id;
      } else {
        // Regular order - rate the user
        rated_type = 'user';
        rated_id = order.user_id;
      }
    } else if (rater_type === 'user' && rater_id === order.user_id) {
      // User is rating the merchant
      rated_type = 'merchant';
      rated_id = order.merchant_id;
    } else if (rater_type === 'merchant' && rater_id === order.buyer_merchant_id) {
      // Buyer merchant (M2M) is rating the seller merchant
      rated_type = 'merchant';
      rated_id = order.merchant_id;
    } else {
      return forbiddenResponse('You are not part of this order');
    }

    // Create the rating
    const newRating = await createRating({
      order_id,
      rater_type,
      rater_id,
      rated_type,
      rated_id,
      rating,
      review_text,
    });

    return successResponse(newRating, 201);
  } catch (error) {
    console.error('Error creating rating:', error);
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return validationErrorResponse(['You have already rated this order']);
    }
    return errorResponse('Internal server error');
  }
}
