import { NextRequest, NextResponse } from 'next/server';
import {
  getMerchantPaymentMethods,
  addMerchantPaymentMethod,
  deleteMerchantPaymentMethod,
  setMerchantPaymentMethodDefault,
} from '@/lib/db/repositories/merchantPaymentMethods';
import { uuidSchema } from '@/lib/validation/schemas';
import {
  requireAuth,
  verifyMerchant,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const VALID_TYPES = ['bank', 'cash', 'crypto', 'card', 'mobile'] as const;

// GET /api/merchant/[id]/payment-methods
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const v = uuidSchema.safeParse(id);
    if (!v.success) return validationErrorResponse(['Invalid merchant ID format']);

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'merchant' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden(`GET /api/merchant/${id}/payment-methods`, auth.actorId, 'Not owner');
      return forbiddenResponse('You can only access your own payment methods');
    }

    const methods = await getMerchantPaymentMethods(id);
    return successResponse(methods);
  } catch (error) {
    logger.api.error('GET', '/api/merchant/[id]/payment-methods', error as Error);
    return errorResponse('Internal server error');
  }
}

// POST /api/merchant/[id]/payment-methods
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const v = uuidSchema.safeParse(id);
    if (!v.success) return validationErrorResponse(['Invalid merchant ID format']);

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'merchant' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden(`POST /api/merchant/${id}/payment-methods`, auth.actorId, 'Not owner');
      return forbiddenResponse(
        'Your session has expired. Please log in again to add a payment method.',
        'SESSION_EXPIRED',
      );
    }

    const merchantExists = await verifyMerchant(id);
    if (!merchantExists) return validationErrorResponse(['Merchant not found']);

    const body = await request.json();
    const { type, name, details, is_default } = body;

    // Validate. Matches the client-side rules in PaymentMethodModal.tsx so
    // a crafted request can't smuggle junk past the UI.
    const errors: string[] = [];
    if (!type || !VALID_TYPES.includes(type)) {
      errors.push(`type must be one of: ${VALID_TYPES.join(', ')}`);
    }
    const nameStr = typeof name === 'string' ? name.trim() : '';
    const detailsStr = typeof details === 'string' ? details.trim() : '';
    if (!nameStr || nameStr.length < 2 || nameStr.length > 60) {
      errors.push('name must be 2–60 characters');
    } else if (!/^[A-Za-z0-9 &.,'\-()/]+$/.test(nameStr)) {
      errors.push('name contains unsupported characters');
    }
    if (details !== undefined && typeof details !== 'string') {
      errors.push('details must be a string');
    } else if (detailsStr.length > 200) {
      errors.push('details must be at most 200 characters');
    }
    // Per-type content sanity on details. Details is a composed string
    // (e.g. "Name - 1234567890 (IBAN)") so we check it contains at least
    // something meaningful and isn't a wall of one repeated character.
    if (detailsStr && /^(.)\1{19,}$/.test(detailsStr)) {
      errors.push('details looks like filler (one character repeated)');
    }
    if (errors.length > 0) return validationErrorResponse(errors);

    const method = await addMerchantPaymentMethod({
      merchant_id: id,
      type,
      name: nameStr,
      details: detailsStr,
      is_default: !!is_default,
    });

    logger.info('Merchant payment method added', { merchantId: id, methodId: method.id, type });
    return successResponse(method, 201);
  } catch (error) {
    logger.api.error('POST', '/api/merchant/[id]/payment-methods', error as Error);
    return errorResponse('Internal server error');
  }
}

// DELETE /api/merchant/[id]/payment-methods
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const v = uuidSchema.safeParse(id);
    if (!v.success) return validationErrorResponse(['Invalid merchant ID format']);

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'merchant' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden(`DELETE /api/merchant/${id}/payment-methods`, auth.actorId, 'Not owner');
      return forbiddenResponse('You can only delete your own payment methods');
    }

    const { searchParams } = request.nextUrl;
    const methodId = searchParams.get('method_id');
    if (!methodId) return validationErrorResponse(['method_id query param is required']);
    const mv = uuidSchema.safeParse(methodId);
    if (!mv.success) return validationErrorResponse(['Invalid method_id format']);

    const deleted = await deleteMerchantPaymentMethod(methodId, id);
    if (!deleted) return validationErrorResponse(['Payment method not found']);

    logger.info('Merchant payment method deleted', { merchantId: id, methodId });
    return successResponse({ deleted: true });
  } catch (error) {
    logger.api.error('DELETE', '/api/merchant/[id]/payment-methods', error as Error);
    return errorResponse('Internal server error');
  }
}

// PATCH /api/merchant/[id]/payment-methods — set default
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const v = uuidSchema.safeParse(id);
    if (!v.success) return validationErrorResponse(['Invalid merchant ID format']);

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'merchant' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden(`PATCH /api/merchant/${id}/payment-methods`, auth.actorId, 'Not owner');
      return forbiddenResponse('You can only modify your own payment methods');
    }

    const body = await request.json();
    const { method_id } = body;
    if (!method_id) return validationErrorResponse(['method_id is required']);
    const mv = uuidSchema.safeParse(method_id);
    if (!mv.success) return validationErrorResponse(['Invalid method_id format']);

    const updated = await setMerchantPaymentMethodDefault(method_id, id);
    if (!updated) return validationErrorResponse(['Payment method not found']);

    logger.info('Merchant payment method set as default', { merchantId: id, methodId: method_id });
    return successResponse(updated);
  } catch (error) {
    logger.api.error('PATCH', '/api/merchant/[id]/payment-methods', error as Error);
    return errorResponse('Internal server error');
  }
}
