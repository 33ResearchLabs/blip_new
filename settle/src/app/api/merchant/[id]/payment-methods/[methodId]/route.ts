import { NextRequest, NextResponse } from 'next/server';
import { updateMerchantPaymentMethod } from '@/lib/db/repositories/merchantPaymentMethods';
import { uuidSchema } from '@/lib/validation/schemas';
import {
  requireAuth,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; methodId: string }> };

// PUT /api/merchant/[id]/payment-methods/[methodId] — edit a saved method.
// Validation rules mirror the POST handler in ../route.ts so a crafted
// request can't smuggle junk past the UI.
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id: rawId, methodId } = await params;

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const id = rawId === 'me' ? auth.actorId : rawId;

    if (!uuidSchema.safeParse(id).success) {
      return validationErrorResponse(['Invalid merchant ID format']);
    }
    if (!uuidSchema.safeParse(methodId).success) {
      return validationErrorResponse(['Invalid payment method ID format']);
    }

    const isOwner = auth.actorType === 'merchant' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden(`PUT /api/merchant/${id}/payment-methods/${methodId}`, auth.actorId, 'Not owner');
      return forbiddenResponse('You can only edit your own payment methods');
    }

    const body = await request.json().catch(() => ({}));
    const { name, details } = body ?? {};

    const errors: string[] = [];
    let nameStr: string | undefined;
    let detailsStr: string | undefined;

    if (name !== undefined) {
      if (typeof name !== 'string') {
        errors.push('name must be a string');
      } else {
        nameStr = name.trim();
        if (nameStr.length < 2 || nameStr.length > 60) {
          errors.push('name must be 2–60 characters');
        } else if (!/^[A-Za-z0-9 &.,'\-()/]+$/.test(nameStr)) {
          errors.push('name contains unsupported characters');
        }
      }
    }

    if (details !== undefined) {
      if (typeof details !== 'string') {
        errors.push('details must be a string');
      } else {
        detailsStr = details.trim();
        if (detailsStr.length > 200) {
          errors.push('details must be at most 200 characters');
        } else if (detailsStr && /^(.)\1{19,}$/.test(detailsStr)) {
          errors.push('details looks like filler (one character repeated)');
        }
      }
    }

    if (errors.length > 0) return validationErrorResponse(errors);
    if (nameStr === undefined && detailsStr === undefined) {
      return validationErrorResponse(['Provide at least one of: name, details']);
    }

    const updated = await updateMerchantPaymentMethod(methodId, id, {
      name: nameStr,
      details: detailsStr,
    });
    if (!updated) return notFoundResponse('Payment method');

    logger.info('Merchant payment method updated', { merchantId: id, methodId });
    return successResponse(updated);
  } catch (error) {
    logger.api.error('PUT', '/api/merchant/[id]/payment-methods/[methodId]', error as Error);
    return errorResponse('Internal server error');
  }
}
