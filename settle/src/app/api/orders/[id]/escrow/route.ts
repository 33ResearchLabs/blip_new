import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getOrderWithRelations,
} from '@/lib/db/repositories/orders';
import { logger } from 'settlement-core';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import {
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
import { serializeOrder } from '@/lib/api/orderSerializer';
import { MOCK_MODE } from '@/lib/config/mockMode';
import { mockEscrowLock } from '@/lib/money/escrowLock';

// Schema for escrow deposit
const escrowDepositSchema = z.object({
  tx_hash: z.string().min(1, 'Transaction hash is required'),
  actor_type: z.enum(['user', 'merchant']),
  actor_id: z.string().uuid(),
  escrow_address: z.string().nullish(),
  // On-chain escrow references for release
  escrow_trade_id: z.number().nullish(),
  escrow_trade_pda: z.string().nullish(),
  escrow_pda: z.string().nullish(),
  escrow_creator_wallet: z.string().nullish(),
});

// Schema for escrow release
const escrowReleaseSchema = z.object({
  tx_hash: z.string().min(1, 'Transaction hash is required'),
  actor_type: z.enum(['user', 'merchant', 'system']),
  actor_id: z.string().uuid(),
});

// GET - Get escrow status for an order (read-only, stays local)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    // Get auth context
    const auth = getAuthContext(request);

    // Fetch order
    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Check authorization
    if (auth) {
      const canAccess = await canAccessOrder(auth, id);
      if (!canAccess) {
        return forbiddenResponse('You do not have access to this order');
      }
    }

    // Return escrow details with minimal_status
    const escrowData = serializeOrder({
      order_id: order.id,
      status: order.status,
      escrow_tx_hash: order.escrow_tx_hash,
      escrow_address: order.escrow_address,
      release_tx_hash: order.release_tx_hash,
      escrowed_at: order.escrowed_at,
      crypto_amount: order.crypto_amount,
      crypto_currency: order.crypto_currency,
      is_escrowed: ['escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'releasing'].includes(order.status),
      is_released: order.status === 'completed' && order.release_tx_hash,
    });

    return successResponse(escrowData);
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/escrow', error as Error);
    return errorResponse('Internal server error');
  }
}

// POST - Record escrow deposit (proxied to core-api)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    const body = await request.json();

    // Validate request body
    const parseResult = escrowDepositSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    // Mock mode (or Core-API absent): handle escrow lock locally
    const isMockMode = MOCK_MODE || !process.env.CORE_API_URL;
    if (isMockMode) {
      const result = await mockEscrowLock(
        id,
        parseResult.data.actor_type,
        parseResult.data.actor_id,
        parseResult.data.tx_hash || `mock-escrow-${id}-${Date.now()}`,
        {
          escrow_trade_id: parseResult.data.escrow_trade_id ?? undefined,
          escrow_trade_pda: parseResult.data.escrow_trade_pda ?? undefined,
          escrow_pda: parseResult.data.escrow_pda ?? undefined,
          escrow_creator_wallet: parseResult.data.escrow_creator_wallet ?? undefined,
        }
      );

      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 400 }
        );
      }
      return NextResponse.json({
        success: true,
        data: serializeOrder(result.order!),
      });
    }

    // Non-mock mode: forward to core-api (single writer for all mutations)
    return proxyCoreApi(`/v1/orders/${id}/escrow`, {
      method: 'POST',
      body: parseResult.data,
    });
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/escrow', error as Error);
    return errorResponse('Internal server error');
  }
}

// PATCH - Record escrow release (proxied to core-api)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    const body = await request.json();

    // Validate request body
    const parseResult = escrowReleaseSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { tx_hash, actor_type, actor_id } = parseResult.data;

    // Forward to core-api (single writer for all mutations)
    return proxyCoreApi(`/v1/orders/${id}/events`, {
      method: 'POST',
      body: { event_type: 'release', tx_hash },
      actorType: actor_type,
      actorId: actor_id,
    });
  } catch (error) {
    logger.api.error('PATCH', '/api/orders/[id]/escrow', error as Error);
    return errorResponse('Internal server error');
  }
}
