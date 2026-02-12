import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getOrderById,
  getOrderWithRelations,
  updateOrderStatus,
} from '@/lib/db/repositories/orders';
import { query, transaction as dbTransaction } from '@/lib/db';
import { MOCK_MODE } from '@/lib/config/mockMode';
import { createTransaction } from '@/lib/db/repositories/transactions';
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
import { wsBroadcastOrderUpdate } from '@/lib/websocket/broadcast';
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
    // SECURITY: demo- prefix ONLY allowed in MOCK_MODE to prevent bypass in production
    const isDemoTx = tx_hash.startsWith('demo-');

    if (isDemoTx && !MOCK_MODE) {
      return NextResponse.json(
        { success: false, error: 'Demo transactions not allowed in production mode' },
        { status: 400 }
      );
    }

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

    // Wrap balance deduction + order update in a DB transaction
    // This prevents balance being deducted if the order update fails (e.g. integer overflow)
    // CRITICAL: Lock the order row INSIDE the transaction to prevent double-lock race condition
    const amount = parseFloat(String(order.crypto_amount));

    try {
      await dbTransaction(async (client) => {
        // Lock the order row and re-check status to prevent double-lock
        const lockCheck = await client.query(
          'SELECT status, escrow_tx_hash FROM orders WHERE id = $1 FOR UPDATE',
          [id]
        );
        const lockedOrder = lockCheck.rows[0];
        if (!lockedOrder || !['pending', 'accepted', 'escrow_pending'].includes(lockedOrder.status)) {
          throw new Error('ORDER_STATUS_CHANGED');
        }
        if (lockedOrder.escrow_tx_hash) {
          throw new Error('ALREADY_ESCROWED');
        }

        // In mock mode, deduct the escrowed amount from the seller's balance
        if (MOCK_MODE) {
          const sellerTable = actor_type === 'merchant' ? 'merchants' : 'users';
          const deductResult = await client.query(
            `UPDATE ${sellerTable} SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance`,
            [amount, actor_id]
          );
          if (!deductResult || deductResult.rows.length === 0) {
            throw new Error('INSUFFICIENT_BALANCE');
          }
          logger.info('[Mock] Deducted escrow from seller', { actorId: actor_id, amount, table: sellerTable });
        }

        // Update order with escrow details (including on-chain references for release)
        // Cast escrow_trade_id to BIGINT to handle large timestamp values from Date.now()
        // Also extend expires_at to 120 minutes from now (escrowed orders get more time)
        await client.query(
          `UPDATE orders SET
            escrow_tx_hash = $1,
            escrow_address = $2,
            escrow_trade_id = $3::BIGINT,
            escrow_trade_pda = $4,
            escrow_pda = $5,
            escrow_creator_wallet = $6,
            escrowed_at = NOW(),
            expires_at = NOW() + INTERVAL '120 minutes',
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
      });
    } catch (txError) {
      const errMsg = (txError as Error).message;
      if (errMsg === 'INSUFFICIENT_BALANCE') {
        return NextResponse.json(
          { success: false, error: 'Insufficient balance to lock escrow' },
          { status: 400 }
        );
      }
      if (errMsg === 'ALREADY_ESCROWED') {
        return NextResponse.json(
          { success: false, error: 'Escrow already locked on this order' },
          { status: 409 }
        );
      }
      if (errMsg === 'ORDER_STATUS_CHANGED') {
        return NextResponse.json(
          { success: false, error: 'Order status changed — cannot lock escrow' },
          { status: 409 }
        );
      }
      logger.error('Escrow deposit transaction failed (balance rolled back)', {
        orderId: id, error: errMsg, actorId: actor_id,
      });
      return errorResponse(`Failed to record escrow: ${errMsg}`);
    }

    // Log transaction outside the DB transaction (non-critical, best-effort)
    if (MOCK_MODE) {
      try {
        await createTransaction({
          merchant_id: actor_type === 'merchant' ? actor_id : undefined,
          user_id: actor_type === 'user' ? actor_id : undefined,
          order_id: id,
          type: 'escrow_lock',
          amount: -amount,
          description: `Locked ${amount} USDC in escrow for order #${order.order_number}`,
        });
      } catch (logErr) {
        logger.warn('Failed to log escrow transaction', { orderId: id, error: logErr });
      }
    }

    // Get updated order
    const updatedOrder = await getOrderWithRelations(id);

    // Auto system messages for escrow lock removed - keeping only real user messages

    // Send real-time notification about escrow lock
    if (updatedOrder) {
      const escrowPayload = {
        orderId: id,
        userId: updatedOrder.user_id,
        merchantId: updatedOrder.merchant_id,
        status: 'escrowed',
        previousStatus: order.status,
        updatedAt: new Date().toISOString(),
        data: updatedOrder,
      };

      notifyOrderStatusUpdated(escrowPayload);

      if (updatedOrder.buyer_merchant_id && updatedOrder.buyer_merchant_id !== updatedOrder.merchant_id) {
        notifyOrderStatusUpdated({ ...escrowPayload, merchantId: updatedOrder.buyer_merchant_id });
      }

      // WebSocket broadcast
      wsBroadcastOrderUpdate({
        orderId: id,
        status: 'escrowed',
        previousStatus: order.status,
        updatedAt: escrowPayload.updatedAt,
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
    // SECURITY: demo- prefix ONLY allowed in MOCK_MODE to prevent bypass in production
    const isDemoTx = tx_hash.startsWith('demo-');

    if (isDemoTx && !MOCK_MODE) {
      return NextResponse.json(
        { success: false, error: 'Demo transactions not allowed in production mode' },
        { status: 400 }
      );
    }

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

    // Wrap balance credit + release_tx_hash in a DB transaction
    // CRITICAL: Lock the order row INSIDE the transaction to prevent double-release race condition
    // Two concurrent releases without this lock would both credit the buyer (money printer bug)
    const amount = parseFloat(String(order.crypto_amount));
    const isBuyOrder = order.type === 'buy';
    const recipientId = isBuyOrder
      ? (order.buyer_merchant_id || order.user_id)
      : (order.buyer_merchant_id || order.merchant_id);
    const recipientTable = isBuyOrder
      ? (order.buyer_merchant_id ? 'merchants' : 'users')
      : 'merchants';

    // Track fee collected for transaction log (set inside dbTransaction)
    let collectedFeeAmount = 0;

    try {
      await dbTransaction(async (client) => {
        // Lock the order row and re-check to prevent double-release
        const lockCheck = await client.query(
          'SELECT status, release_tx_hash FROM orders WHERE id = $1 FOR UPDATE',
          [id]
        );
        const lockedOrder = lockCheck.rows[0];
        if (!lockedOrder || !['escrowed', 'payment_sent', 'payment_confirmed', 'releasing'].includes(lockedOrder.status)) {
          throw new Error('ORDER_STATUS_CHANGED');
        }
        if (lockedOrder.release_tx_hash) {
          throw new Error('ALREADY_RELEASED');
        }

        // Credit the buyer's balance (net of protocol fee)
        if (MOCK_MODE) {
          const feeAmount = parseFloat(String(order.protocol_fee_amount)) || 0;
          const buyerReceives = amount - feeAmount;

          await client.query(
            `UPDATE ${recipientTable} SET balance = balance + $1 WHERE id = $2`,
            [buyerReceives, recipientId]
          );
          logger.info('[Mock] Credited buyer on release', {
            recipientId, grossAmount: amount, feeAmount, netAmount: buyerReceives, table: recipientTable,
          });

          // Collect platform fee
          if (feeAmount > 0) {
            const platformResult = await client.query(
              `UPDATE platform_balance
               SET balance = balance + $1,
                   total_fees_collected = total_fees_collected + $1,
                   updated_at = NOW()
               WHERE key = 'main'
               RETURNING balance`,
              [feeAmount]
            );
            const newPlatformBalance = parseFloat(String(platformResult.rows[0]?.balance || 0));

            await client.query(
              `INSERT INTO platform_fee_transactions
               (order_id, fee_amount, fee_percentage, spread_preference, platform_balance_after)
               VALUES ($1, $2, $3, $4, $5)`,
              [id, feeAmount,
               parseFloat(String(order.protocol_fee_percentage)) || 0,
               order.spread_preference || 'fastest',
               newPlatformBalance]
            );
            collectedFeeAmount = feeAmount;
            logger.info('[Mock] Platform fee collected', { orderId: id, feeAmount, newPlatformBalance });
          }
        }

        // Record release_tx_hash and completed_at (status updated separately via state machine)
        await client.query(
          `UPDATE orders SET
            release_tx_hash = $1,
            completed_at = NOW()
          WHERE id = $2`,
          [tx_hash, id]
        );
      });
    } catch (txError) {
      const errMsg = (txError as Error).message;
      if (errMsg === 'ALREADY_RELEASED') {
        return NextResponse.json(
          { success: false, error: 'Escrow already released on this order' },
          { status: 409 }
        );
      }
      if (errMsg === 'ORDER_STATUS_CHANGED') {
        return NextResponse.json(
          { success: false, error: 'Order status changed — cannot release escrow' },
          { status: 409 }
        );
      }
      logger.error('Escrow release transaction failed (balance + order update rolled back)', {
        orderId: id, error: errMsg, recipientId,
      });
      return errorResponse(`Failed to release escrow: ${errMsg}`);
    }

    // Log transaction record (best-effort, outside main transaction)
    if (MOCK_MODE) {
      const netAmount = amount - collectedFeeAmount;
      try {
        await createTransaction({
          merchant_id: recipientTable === 'merchants' ? recipientId : undefined,
          user_id: recipientTable === 'users' ? recipientId : undefined,
          order_id: id,
          type: 'escrow_release',
          amount: netAmount,
          description: `Received ${netAmount} USDC from escrow release for order #${order.order_number}${collectedFeeAmount > 0 ? ` (${collectedFeeAmount.toFixed(2)} USDC fee)` : ''}`,
        });
      } catch (logErr) {
        logger.warn('Failed to log escrow release transaction', { orderId: id, error: logErr });
      }
    }

    // Update status via state machine (handles event history, reputation, etc.)
    // release_tx_hash is already set above, so the PATCH completion handler
    // won't double-credit (it checks !order.release_tx_hash)
    const result = await updateOrderStatus(
      id,
      'completed',
      actor_type,
      actor_id,
      { release_tx_hash: tx_hash }
    );

    if (!result.success) {
      // Credit already went through but status update failed.
      // Log the error but don't return failure — buyer already got their funds.
      logger.error('Status update to completed failed after release credit', {
        orderId: id, error: result.error,
      });
    }

    // Auto system messages for escrow release removed - keeping only real user messages

    // Send real-time notification
    if (result.order) {
      const releasePayload = {
        orderId: id,
        userId: result.order.user_id,
        merchantId: result.order.merchant_id,
        status: 'completed',
        previousStatus: order.status,
        updatedAt: new Date().toISOString(),
        data: result.order,
      };

      notifyOrderStatusUpdated(releasePayload);

      if (result.order.buyer_merchant_id && result.order.buyer_merchant_id !== result.order.merchant_id) {
        notifyOrderStatusUpdated({ ...releasePayload, merchantId: result.order.buyer_merchant_id });
      }

      // WebSocket broadcast
      wsBroadcastOrderUpdate({
        orderId: id,
        status: 'completed',
        previousStatus: order.status,
        updatedAt: releasePayload.updatedAt,
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
