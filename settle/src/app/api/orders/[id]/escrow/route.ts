import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getOrderById,
  getOrderWithRelations,
  updateOrderStatus,
  sendMessage,
} from '@/lib/db/repositories/orders';
import { query } from '@/lib/db';
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
import { logger } from '@/lib/logger';
import { notifyOrderStatusUpdated } from '@/lib/pusher/server';
import { waitForConfirmation, getConnection } from '@/lib/solana';

// Schema for escrow deposit
const escrowDepositSchema = z.object({
  tx_hash: z.string().min(1, 'Transaction hash is required'),
  actor_type: z.enum(['user', 'merchant']),
  actor_id: z.string().uuid(),
  escrow_address: z.string().optional(),
  // On-chain escrow references for release
  escrow_trade_id: z.number().optional(),
  escrow_trade_pda: z.string().optional(),
  escrow_pda: z.string().optional(),
  escrow_creator_wallet: z.string().optional(),
});

// Schema for escrow release
const escrowReleaseSchema = z.object({
  tx_hash: z.string().min(1, 'Transaction hash is required'),
  actor_type: z.enum(['user', 'merchant', 'system']),
  actor_id: z.string().uuid(),
});

// GET - Get escrow status for an order
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

    // Return escrow details
    const escrowData = {
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
    };

    return successResponse(escrowData);
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/escrow', error as Error);
    return errorResponse('Internal server error');
  }
}

// POST - Record escrow deposit (after user signs transaction)
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

    const {
      tx_hash,
      actor_type,
      actor_id,
      escrow_address,
      escrow_trade_id,
      escrow_trade_pda,
      escrow_pda,
      escrow_creator_wallet,
    } = parseResult.data;

    // Fetch order
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Check authorization
    const auth = { actorType: actor_type as 'user' | 'merchant', actorId: actor_id };
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    // Only allow escrow deposit from pending, accepted or escrow_pending status
    if (!['pending', 'accepted', 'escrow_pending'].includes(order.status)) {
      return NextResponse.json(
        { success: false, error: `Cannot deposit to escrow from status '${order.status}'` },
        { status: 400 }
      );
    }

    // Check if this is a demo/off-chain transaction (no real on-chain verification needed)
    const isDemoTx = tx_hash.startsWith('demo-');

    if (!isDemoTx) {
      // Verify transaction on-chain with retries (devnet can be slow to propagate)
      const connection = getConnection('devnet');
      const confirmed = await waitForConfirmation(connection, tx_hash, 15000);

      if (!confirmed) {
        return NextResponse.json(
          { success: false, error: 'Transaction not confirmed after retries' },
          { status: 400 }
        );
      }
    } else {
      logger.info('Demo escrow transaction - skipping on-chain verification', { txHash: tx_hash, orderId: id });
    }

    // Update order with escrow details (including on-chain references for release)
    // Also update status to 'escrowed' since funds are now locked on-chain
    await query(
      `UPDATE orders SET
        escrow_tx_hash = $1,
        escrow_address = $2,
        escrow_trade_id = $3,
        escrow_trade_pda = $4,
        escrow_pda = $5,
        escrow_creator_wallet = $6,
        escrowed_at = NOW(),
        status = 'escrowed'
      WHERE id = $7`,
      [
        tx_hash,
        escrow_address || null,
        escrow_trade_id || null,
        escrow_trade_pda || null,
        escrow_pda || null,
        escrow_creator_wallet || null,
        id,
      ]
    );

    // Get updated order
    const updatedOrder = await getOrderWithRelations(id);

    // Send system message about escrow lock
    try {
      await sendMessage({
        order_id: id,
        sender_type: 'system',
        sender_id: id,
        content: `🔒 Escrow locked - ${order.crypto_amount} ${order.crypto_currency} secured on-chain`,
        message_type: 'system',
      });
    } catch (msgError) {
      logger.api.error('POST', `/api/orders/${id}/escrow/system-message`, msgError as Error);
    }

    // Send real-time notification about escrow lock
    if (updatedOrder) {
      notifyOrderStatusUpdated({
        orderId: id,
        userId: updatedOrder.user_id,
        merchantId: updatedOrder.merchant_id,
        status: 'escrowed',
        previousStatus: order.status,
        updatedAt: new Date().toISOString(),
        data: updatedOrder,
      });
    }

    logger.info('Escrow deposit recorded', {
      orderId: id,
      txHash: tx_hash,
      actorType: actor_type,
      actorId: actor_id,
    });

    return successResponse({
      ...updatedOrder,
      escrow_verified: true,
      escrow_tx_hash: tx_hash,
    });
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/escrow', error as Error);
    return errorResponse('Internal server error');
  }
}

// PATCH - Record escrow release
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

    // Fetch order
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Check authorization
    const auth = { actorType: actor_type as 'user' | 'merchant' | 'system', actorId: actor_id };
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    // Only allow release from escrowed, payment_sent, payment_confirmed or releasing status
    // For sell orders: user releases after merchant marks payment_sent
    // For buy orders: merchant releases after user confirms payment (payment_confirmed)
    // Also allow from 'escrowed' status for immediate releases after escrow lock
    if (!['escrowed', 'payment_sent', 'payment_confirmed', 'releasing'].includes(order.status)) {
      return NextResponse.json(
        { success: false, error: `Cannot release escrow from status '${order.status}'` },
        { status: 400 }
      );
    }

    // Check if this is a demo/off-chain transaction (no real on-chain verification needed)
    const isDemoTx = tx_hash.startsWith('demo-');

    if (!isDemoTx) {
      // Verify transaction on-chain with retries (devnet can be slow to propagate)
      const connection = getConnection('devnet');
      const confirmed = await waitForConfirmation(connection, tx_hash, 15000);

      if (!confirmed) {
        return NextResponse.json(
          { success: false, error: 'Release transaction not confirmed after retries' },
          { status: 400 }
        );
      }
    } else {
      logger.info('Demo escrow release - skipping on-chain verification', { txHash: tx_hash, orderId: id });
    }

    // Update order with release details
    await query(
      `UPDATE orders SET
        release_tx_hash = $1,
        completed_at = NOW()
      WHERE id = $2`,
      [tx_hash, id]
    );

    // Update order status to completed
    const result = await updateOrderStatus(
      id,
      'completed',
      actor_type,
      actor_id,
      { release_tx_hash: tx_hash }
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // Send system messages for escrow release and completion
    try {
      await sendMessage({
        order_id: id,
        sender_type: 'system',
        sender_id: id,
        content: `🔓 Escrow released - funds sent to merchant`,
        message_type: 'system',
      });
      await sendMessage({
        order_id: id,
        sender_type: 'system',
        sender_id: id,
        content: `🎉 Trade completed successfully!`,
        message_type: 'system',
      });
    } catch (msgError) {
      logger.api.error('PATCH', `/api/orders/${id}/escrow/system-message`, msgError as Error);
    }

    // Send real-time notification
    if (result.order) {
      notifyOrderStatusUpdated({
        orderId: id,
        userId: result.order.user_id,
        merchantId: result.order.merchant_id,
        status: 'completed',
        previousStatus: order.status,
        updatedAt: new Date().toISOString(),
        data: result.order,
      });
    }

    logger.info('Escrow release recorded', {
      orderId: id,
      txHash: tx_hash,
      actorType: actor_type,
      actorId: actor_id,
    });

    return successResponse({
      ...result.order,
      release_verified: true,
      release_tx_hash: tx_hash,
    });
  } catch (error) {
    logger.api.error('PATCH', '/api/orders/[id]/escrow', error as Error);
    return errorResponse('Internal server error');
  }
}
