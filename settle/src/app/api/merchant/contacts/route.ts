import { NextRequest } from 'next/server';
import {
  getMerchantContacts,
  updateMerchantContact,
} from '@/lib/db/repositories/directMessages';
import {
  getAuthContext,
  verifyMerchant,
  forbiddenResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';

// GET /api/merchant/contacts - Get all contacts
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');

    if (!merchantId) {
      return validationErrorResponse(['merchant_id is required']);
    }

    // Authorization check
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchantId;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only access your own contacts');
      }
    }

    // Verify merchant exists
    const merchantExists = await verifyMerchant(merchantId);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    const contacts = await getMerchantContacts(merchantId);

    return successResponse(contacts);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return errorResponse('Internal server error');
  }
}

// PATCH /api/merchant/contacts - Update contact (nickname, notes, favorite)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { merchant_id, contact_id, nickname, notes, is_favorite } = body;

    if (!merchant_id || !contact_id) {
      return validationErrorResponse(['merchant_id and contact_id are required']);
    }

    // Authorization check
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchant_id;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only update your own contacts');
      }
    }

    const contact = await updateMerchantContact(contact_id, merchant_id, {
      nickname,
      notes,
      is_favorite,
    });

    if (!contact) {
      return validationErrorResponse(['Contact not found']);
    }

    return successResponse(contact);
  } catch (error) {
    console.error('Error updating contact:', error);
    return errorResponse('Internal server error');
  }
}
