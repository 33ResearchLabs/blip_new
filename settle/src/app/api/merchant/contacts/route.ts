import { NextRequest } from 'next/server';
import {
  getMerchantContacts,
  updateMerchantContact,
  addContact,
  removeContact,
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

// POST /api/merchant/contacts - Add a contact (add friend)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { merchant_id, target_id, target_type } = body;

    if (!merchant_id || !target_id || !target_type) {
      return validationErrorResponse(['merchant_id, target_id, and target_type are required']);
    }

    if (!['user', 'merchant'].includes(target_type)) {
      return validationErrorResponse(['target_type must be "user" or "merchant"']);
    }

    if (target_type === 'merchant' && target_id === merchant_id) {
      return validationErrorResponse(['Cannot add yourself as a contact']);
    }

    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchant_id;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only add contacts to your own list');
      }
    }

    const merchantExists = await verifyMerchant(merchant_id);
    if (!merchantExists) {
      return validationErrorResponse(['Merchant not found']);
    }

    const contact = await addContact({ merchant_id, target_id, target_type });
    return successResponse(contact, 201);
  } catch (error) {
    console.error('Error adding contact:', error);
    return errorResponse('Internal server error');
  }
}

// DELETE /api/merchant/contacts - Remove a contact
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id');
    const contactId = searchParams.get('contact_id');

    if (!merchantId || !contactId) {
      return validationErrorResponse(['merchant_id and contact_id are required']);
    }

    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'merchant' && auth.actorId === merchantId;
      if (!isOwner && auth.actorType !== 'system') {
        return forbiddenResponse('You can only remove your own contacts');
      }
    }

    const removed = await removeContact(contactId, merchantId);
    if (!removed) {
      return validationErrorResponse(['Contact not found']);
    }

    return successResponse({ removed: true });
  } catch (error) {
    console.error('Error removing contact:', error);
    return errorResponse('Internal server error');
  }
}
