import { NextRequest } from 'next/server';
import { updateOffer, getOfferById, deleteOffer } from '@/lib/db/repositories/merchants';
import { updateOfferSchema, uuidSchema } from '@/lib/validation/schemas';
import {
  getAuthContext,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/merchant/offers/[id]
 * Get a specific offer by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Validate offer ID
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid offer ID format']);
    }

    const offer = await getOfferById(id);

    if (!offer) {
      return errorResponse('Offer not found', 404);
    }

    logger.api.request('GET', `/api/merchant/offers/${id}`);
    return successResponse(offer);
  } catch (error) {
    logger.api.error('GET', '/api/merchant/offers/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}

/**
 * PATCH /api/merchant/offers/[id]
 * Update an existing offer
 *
 * IMPORTANT: Edits only affect FUTURE orders.
 * Existing orders have their rate/terms frozen at acceptance.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate offer ID
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid offer ID format']);
    }

    // Validate request body
    const parseResult = updateOfferSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const updateData = parseResult.data;

    // Get current offer to verify ownership
    const currentOffer = await getOfferById(id);
    if (!currentOffer) {
      return errorResponse('Offer not found', 404);
    }

    // Authorization: only the merchant can update their own offers
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === currentOffer.merchant_id;
      if (!isOwner && auth.actorType !== 'system') {
        logger.auth.forbidden('PATCH /api/merchant/offers/[id]', auth.actorId, 'Not offer owner');
        return forbiddenResponse('You can only update your own offers');
      }
    }

    // Additional validation: max_amount >= min_amount
    if (updateData.min_amount !== undefined || updateData.max_amount !== undefined) {
      const newMin = updateData.min_amount ?? currentOffer.min_amount;
      const newMax = updateData.max_amount ?? currentOffer.max_amount;
      if (newMax < newMin) {
        return validationErrorResponse(['max_amount must be greater than or equal to min_amount']);
      }
    }

    // Validate rate > 0
    if (updateData.rate !== undefined && updateData.rate <= 0) {
      return validationErrorResponse(['rate must be positive']);
    }

    // Update the offer
    const updatedOffer = await updateOffer(id, currentOffer.merchant_id, updateData);

    if (!updatedOffer) {
      return errorResponse('Failed to update offer', 500);
    }

    logger.info('Offer updated', {
      offerId: id,
      merchantId: currentOffer.merchant_id,
      changes: Object.keys(updateData),
    });

    return successResponse({
      ...updatedOffer,
      _note: 'Edits affect new orders only. Active orders remain unchanged.',
    });
  } catch (error) {
    logger.api.error('PATCH', '/api/merchant/offers/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}

/**
 * DELETE /api/merchant/offers/[id]
 * Delete an offer (soft delete by setting is_active = false, or hard delete)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Validate offer ID
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid offer ID format']);
    }

    // Get current offer to verify ownership
    const currentOffer = await getOfferById(id);
    if (!currentOffer) {
      return errorResponse('Offer not found', 404);
    }

    // Authorization: only the merchant can delete their own offers
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === currentOffer.merchant_id;
      if (!isOwner && auth.actorType !== 'system') {
        logger.auth.forbidden('DELETE /api/merchant/offers/[id]', auth.actorId, 'Not offer owner');
        return forbiddenResponse('You can only delete your own offers');
      }
    }

    // Perform deletion
    const deleted = await deleteOffer(id, currentOffer.merchant_id);

    if (!deleted) {
      return errorResponse('Failed to delete offer', 500);
    }

    logger.info('Offer deleted', {
      offerId: id,
      merchantId: currentOffer.merchant_id,
    });

    return successResponse({ deleted: true, id });
  } catch (error) {
    logger.api.error('DELETE', '/api/merchant/offers/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}
