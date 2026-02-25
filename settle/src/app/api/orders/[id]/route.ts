import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderWithRelations,
} from '@/lib/db/repositories/orders';
import {
  logger,
  normalizeStatus,
  validateTransition,
  shouldRestoreLiquidity,
} from 'settlement-core';
import {
  updateOrderStatusSchema,
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
import { proxyCoreApi, signActorHeaders } from '@/lib/proxy/coreApi';
import { MOCK_MODE } from '@/lib/config/mockMode';
import { atomicCancelWithRefund } from '@/lib/orders/atomicCancel';
import { serializeOrder } from '@/lib/api/orderSerializer';
import { notifyOrderStatusUpdated } from '@/lib/pusher/server';
import { emitOrderEvent, buildEvent } from '@/lib/events';
import { FEATURES } from '@/lib/config/featureFlags';
import { transaction } from '@/lib/db';
import { sendDirectMessage } from '@/lib/db/repositories/directMessages';

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic';

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

    // Get auth context from query params
    const auth = getAuthContext(request);

    // FEATURE FLAG: Proxy to core-api if enabled
    if (process.env.USE_CORE_API === '1' && process.env.CORE_API_URL) {
      try {
        const coreApiUrl = `${process.env.CORE_API_URL}/v1/orders/${id}`;
        const headers: Record<string, string> = {};

        const coreApiSecret = process.env.CORE_API_SECRET;
        if (coreApiSecret) headers['x-core-api-secret'] = coreApiSecret;

        if (auth) {
          headers['x-actor-type'] = auth.actorType;
          headers['x-actor-id'] = auth.actorId;
          if (coreApiSecret) {
            headers['x-actor-signature'] = signActorHeaders(coreApiSecret, auth.actorType, auth.actorId);
          }
        }

        const response = await fetch(coreApiUrl, { headers });
        const data = await response.json();

        return NextResponse.json(data, { status: response.status });
      } catch (proxyError) {
        logger.error('[Proxy] Failed to reach core-api', { error: proxyError });
        // Fall through to local logic
      }
    }

    // LOCAL LOGIC (read-only fallback)
    // Fetch order
    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Check authorization if auth context provided
    if (auth) {
      const canAccess = await canAccessOrder(auth, id);
      if (!canAccess) {
        logger.auth.forbidden(`GET /api/orders/${id}`, auth.actorId, 'Not order participant');
        return forbiddenResponse('You do not have access to this order');
      }
    }

    // Add minimal_status to response (8-state normalized status)
    const orderWithMinimalStatus = {
      ...order,
      minimal_status: normalizeStatus(order.status),
    };

    logger.api.request('GET', `/api/orders/${id}`, auth?.actorId);
    return successResponse(orderWithMinimalStatus);
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function PATCH(
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

    // Validate request body
    const parseResult = updateOrderStatusSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { status, actor_type, actor_id, reason, acceptor_wallet_address, refund_tx_hash } = parseResult.data;

    // If refund_tx_hash provided, save it to DB regardless of mode
    if (refund_tx_hash) {
      const { query } = await import('@/lib/db');
      await query(`UPDATE orders SET refund_tx_hash = $1 WHERE id = $2`, [refund_tx_hash, id]);
      logger.info('[PATCH /orders] Saved refund_tx_hash', { orderId: id, refund_tx_hash });
    }

    // Mock mode (or Core-API absent): handle cancellation locally with escrow refund
    const isMockMode = MOCK_MODE || !process.env.CORE_API_URL;
    if (isMockMode && status === 'cancelled') {
      // Fetch current order to get its status and details
      const currentOrder = await getOrderWithRelations(id);
      if (!currentOrder) {
        return notFoundResponse('Order');
      }

      // Merchant relist: merchant cancelling accepted order (no escrow) → revert to pending
      const shouldRelistMock =
        actor_type === 'merchant' &&
        currentOrder.status === 'accepted' &&
        !currentOrder.escrow_tx_hash;

      if (shouldRelistMock) {
        const validation = validateTransition(currentOrder.status as any, 'pending' as any, actor_type as any);
        if (!validation.valid) {
          return NextResponse.json(
            { success: false, error: validation.error },
            { status: 400 }
          );
        }

        const relistResult = await transaction(async (client) => {
          const updateResult = await client.query(
            `UPDATE orders
             SET status = 'pending',
                 accepted_at = NULL,
                 acceptor_wallet_address = NULL,
                 buyer_merchant_id = NULL,
                 expires_at = NOW() + INTERVAL '15 minutes',
                 cancelled_at = NULL,
                 cancelled_by = NULL,
                 cancellation_reason = NULL,
                 order_version = order_version + 1
             WHERE id = $1
             RETURNING *`,
            [id]
          );

          const updatedOrder = updateResult.rows[0];

          // Restore liquidity
          if (shouldRestoreLiquidity(currentOrder.status as any, 'pending' as any)) {
            await client.query(
              'UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2',
              [currentOrder.crypto_amount, currentOrder.offer_id]
            );
          }

          return updatedOrder;
        });

        return NextResponse.json({
          success: true,
          data: { ...serializeOrder(relistResult), relisted: true },
        });
      }

      // Use atomicCancelWithRefund for deterministic escrow refund
      const result = await atomicCancelWithRefund(
        id,
        currentOrder.status,
        actor_type,
        actor_id,
        reason ?? undefined,
        {
          type: currentOrder.type,
          crypto_amount: currentOrder.crypto_amount,
          merchant_id: currentOrder.merchant_id,
          user_id: currentOrder.user_id,
          buyer_merchant_id: currentOrder.buyer_merchant_id ?? null,
          order_number: Number(currentOrder.order_number),
          crypto_currency: currentOrder.crypto_currency,
          fiat_amount: currentOrder.fiat_amount,
          fiat_currency: currentOrder.fiat_currency,
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

    // Fetch current order status BEFORE proxy call (for previousStatus tracking)
    const currentOrder = await getOrderWithRelations(id);
    const previousStatus = currentOrder?.status || null;

    // Forward to core-api (single writer for all mutations)
    const response = await proxyCoreApi(`/v1/orders/${id}`, {
      method: 'PATCH',
      body: { status, actor_type, actor_id, reason, acceptor_wallet_address },
    });

    // Fire Pusher notification + system chat messages after successful proxy
    if (response.status >= 200 && response.status < 300) {
      try {
        const resBody = await response.json();
        const order = resBody?.data;
        if (order?.id) {
          // Pusher notification
          notifyOrderStatusUpdated({
            orderId: order.id,
            userId: order.user_id || '',
            merchantId: order.merchant_id || '',
            status: order.status || status,
            minimal_status: normalizeStatus(order.status || status),
            order_version: order.order_version,
            previousStatus,
            updatedAt: new Date().toISOString(),
          }).catch(err => logger.error('[Pusher] Failed to notify status update', { error: err }));

          // System chat message + notification outbox (core-api doesn't write these)
          if (FEATURES.SYSTEM_CHAT_MESSAGES) {
            transaction(async (client) => {
              await emitOrderEvent(
                client,
                buildEvent({
                  orderId: order.id,
                  eventType: `order.${status}` as any,
                  orderVersion: order.order_version || 1,
                  actorType: actor_type as any,
                  actorId: actor_id,
                  previousStatus: previousStatus,
                  newStatus: order.status || status,
                  payload: {
                    userId: order.user_id,
                    merchantId: order.merchant_id,
                    buyerMerchantId: order.buyer_merchant_id,
                    amount: order.crypto_amount,
                    currency: order.crypto_currency || 'USDC',
                    fiatAmount: order.fiat_amount,
                    fiatCurrency: order.fiat_currency || 'AED',
                    reason: reason || undefined,
                  },
                })
              );
            }).catch(err => logger.error('[EventEmitter] Failed to emit after proxy', {
              orderId: order.id, status, error: (err as Error).message,
            }));
          }

          // Send order receipt as Direct Message to counterparty
          if (status === 'accepted') {
            const receiptJson = JSON.stringify({
              type: 'order_receipt',
              orderId: order.id,
              orderNumber: order.order_number || order.id.slice(0, 8).toUpperCase(),
              orderType: order.type,
              cryptoAmount: Number(order.crypto_amount || 0),
              cryptoCurrency: order.crypto_currency || 'USDC',
              fiatAmount: Number(order.fiat_amount || 0),
              fiatCurrency: order.fiat_currency || 'AED',
              rate: Number(order.rate || 0),
              status: 'accepted',
            });

            const isM2M = !!order.buyer_merchant_id;
            if (isM2M && order.buyer_merchant_id) {
              const iAmSeller = actor_id === order.merchant_id;
              sendDirectMessage({
                sender_type: 'merchant',
                sender_id: actor_id,
                recipient_type: 'merchant',
                recipient_id: iAmSeller ? order.buyer_merchant_id : order.merchant_id,
                content: receiptJson,
              }).catch(err => logger.error('[DM] Failed to send order receipt', { orderId: order.id, error: (err as Error).message }));
            } else if (order.merchant_id && order.user_id) {
              sendDirectMessage({
                sender_type: 'merchant',
                sender_id: order.merchant_id,
                recipient_type: 'user',
                recipient_id: order.user_id,
                content: receiptJson,
              }).catch(err => logger.error('[DM] Failed to send order receipt', { orderId: order.id, error: (err as Error).message }));
            }
          }
        }
        return NextResponse.json(resBody, { status: response.status });
      } catch {
        return response;
      }
    }

    return response;
  } catch (error) {
    logger.api.error('PATCH', '/api/orders/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function DELETE(
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

    // Get params from query string
    const searchParams = request.nextUrl.searchParams;
    const actorType = searchParams.get('actor_type');
    const actorId = searchParams.get('actor_id');
    const reason = searchParams.get('reason');

    // Mock mode: handle cancellation locally (mirrors PATCH mock-mode logic)
    const isMockMode = MOCK_MODE || !process.env.CORE_API_URL;
    if (isMockMode) {
      const currentOrder = await getOrderWithRelations(id);
      if (!currentOrder) {
        return notFoundResponse('Order');
      }

      // Merchant relist: merchant cancelling accepted order (no escrow) → revert to pending
      const shouldRelist =
        actorType === 'merchant' &&
        currentOrder.status === 'accepted' &&
        !currentOrder.escrow_tx_hash;

      if (shouldRelist) {
        const validation = validateTransition(currentOrder.status as any, 'pending' as any, actorType as any);
        if (!validation.valid) {
          // Relist not allowed — fall through to regular cancel
          const cancelResult = await atomicCancelWithRefund(
            id,
            currentOrder.status,
            actorType as any,
            actorId || '',
            reason ?? undefined,
            {
              type: currentOrder.type,
              crypto_amount: currentOrder.crypto_amount,
              merchant_id: currentOrder.merchant_id,
              user_id: currentOrder.user_id,
              buyer_merchant_id: currentOrder.buyer_merchant_id ?? null,
              order_number: Number(currentOrder.order_number),
              crypto_currency: currentOrder.crypto_currency,
              fiat_amount: currentOrder.fiat_amount,
              fiat_currency: currentOrder.fiat_currency,
            }
          );

          if (!cancelResult.success) {
            return NextResponse.json(
              { success: false, error: cancelResult.error },
              { status: 400 }
            );
          }

          return NextResponse.json({
            success: true,
            data: serializeOrder(cancelResult.order!),
          });
        }

        const relistResult = await transaction(async (client) => {
          const updateResult = await client.query(
            `UPDATE orders
             SET status = 'pending',
                 accepted_at = NULL,
                 acceptor_wallet_address = NULL,
                 buyer_merchant_id = NULL,
                 expires_at = NOW() + INTERVAL '15 minutes',
                 cancelled_at = NULL,
                 cancelled_by = NULL,
                 cancellation_reason = NULL,
                 order_version = order_version + 1
             WHERE id = $1
             RETURNING *`,
            [id]
          );

          const updatedOrder = updateResult.rows[0];

          if (shouldRestoreLiquidity(currentOrder.status as any, 'pending' as any)) {
            await client.query(
              'UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2',
              [currentOrder.crypto_amount, currentOrder.offer_id]
            );
          }

          return updatedOrder;
        });

        return NextResponse.json({
          success: true,
          data: { ...serializeOrder(relistResult), relisted: true },
        });
      }

      // Regular cancel (with escrow refund if needed)
      const result = await atomicCancelWithRefund(
        id,
        currentOrder.status,
        actorType as any || 'merchant',
        actorId || '',
        reason ?? undefined,
        {
          type: currentOrder.type,
          crypto_amount: currentOrder.crypto_amount,
          merchant_id: currentOrder.merchant_id,
          user_id: currentOrder.user_id,
          buyer_merchant_id: currentOrder.buyer_merchant_id ?? null,
          order_number: Number(currentOrder.order_number),
          crypto_currency: currentOrder.crypto_currency,
          fiat_amount: currentOrder.fiat_amount,
          fiat_currency: currentOrder.fiat_currency,
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

    // Non-mock: proxy to core-api
    const queryStr = `actor_type=${actorType}&actor_id=${actorId}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`;
    return proxyCoreApi(`/v1/orders/${id}?${queryStr}`, { method: 'DELETE' });
  } catch (error) {
    logger.api.error('DELETE', '/api/orders/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}
