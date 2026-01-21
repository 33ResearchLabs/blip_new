import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { Order, ActorType, OrderStatus } from '@/lib/types/database';
import {
  canExtendOrder,
  getExtensionDuration,
  getExpiryOutcome,
} from '@/lib/orders/stateMachine';
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
import { notifyExtensionRequested, notifyExtensionResponse, notifyOrderStatusUpdated } from '@/lib/pusher/server';

const requestExtensionSchema = z.object({
  actor_type: z.enum(['user', 'merchant']),
  actor_id: z.string().uuid(),
});

const respondExtensionSchema = z.object({
  actor_type: z.enum(['user', 'merchant']),
  actor_id: z.string().uuid(),
  accept: z.boolean(),
});

// POST - Request an extension
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const parseResult = requestExtensionSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { actor_type, actor_id } = parseResult.data;

    // Get the order
    const order = await queryOne<Order>(
      'SELECT * FROM orders WHERE id = $1',
      [id]
    );

    if (!order) {
      return notFoundResponse('Order');
    }

    // Check authorization
    const auth = { actorType: actor_type as 'user' | 'merchant', actorId: actor_id };
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    // Check if extension can be requested
    const extensionCheck = canExtendOrder(
      order.status,
      order.extension_count,
      order.max_extensions
    );

    if (!extensionCheck.canExtend) {
      return NextResponse.json(
        { success: false, error: extensionCheck.reason },
        { status: 400 }
      );
    }

    // Check if there's already a pending extension request
    if (order.extension_requested_by) {
      return NextResponse.json(
        { success: false, error: 'An extension request is already pending' },
        { status: 400 }
      );
    }

    // Update order with extension request
    const updatedOrder = await queryOne<Order>(`
      UPDATE orders
      SET extension_requested_by = $2,
          extension_requested_at = NOW(),
          extension_minutes = $3
      WHERE id = $1
      RETURNING *
    `, [id, actor_type, getExtensionDuration(order.status)]);

    // Log the event
    await query(`
      INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
      VALUES ($1, 'extension_requested', $2, $3, $4)
    `, [id, actor_type, actor_id, JSON.stringify({
      extension_count: order.extension_count,
      extension_minutes: getExtensionDuration(order.status),
    })]);

    // Notify the other party
    const recipientType = actor_type === 'merchant' ? 'user' : 'merchant';
    notifyExtensionRequested({
      orderId: id,
      userId: order.user_id,
      merchantId: order.merchant_id,
      requestedBy: actor_type as ActorType,
      extensionMinutes: getExtensionDuration(order.status),
      extensionCount: order.extension_count,
      maxExtensions: order.max_extensions,
    });

    logger.api.request('POST', `/api/orders/${id}/extension`, actor_id);
    return successResponse({
      ...updatedOrder,
      message: `Extension request sent to ${recipientType}`,
    });
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/extension', error as Error);
    return errorResponse('Internal server error');
  }
}

// PUT - Respond to an extension request (accept/decline)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const parseResult = respondExtensionSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { actor_type, actor_id, accept } = parseResult.data;

    // Get the order
    const order = await queryOne<Order>(
      'SELECT * FROM orders WHERE id = $1',
      [id]
    );

    if (!order) {
      return notFoundResponse('Order');
    }

    // Check authorization
    const auth = { actorType: actor_type as 'user' | 'merchant', actorId: actor_id };
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    // Check if there's a pending extension request
    if (!order.extension_requested_by) {
      return NextResponse.json(
        { success: false, error: 'No extension request pending' },
        { status: 400 }
      );
    }

    // Make sure the responder is not the one who requested
    if (order.extension_requested_by === actor_type) {
      return NextResponse.json(
        { success: false, error: 'You cannot respond to your own extension request' },
        { status: 400 }
      );
    }

    let updatedOrder: Order | null;

    if (accept) {
      // Accept extension - extend the expiry time
      const extensionMinutes = order.extension_minutes || getExtensionDuration(order.status);

      updatedOrder = await queryOne<Order>(`
        UPDATE orders
        SET extension_count = extension_count + 1,
            extension_requested_by = NULL,
            extension_requested_at = NULL,
            expires_at = COALESCE(expires_at, NOW()) + INTERVAL '1 minute' * $2
        WHERE id = $1
        RETURNING *
      `, [id, extensionMinutes]);

      // Log the event
      await query(`
        INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
        VALUES ($1, 'extension_accepted', $2, $3, $4)
      `, [id, actor_type, actor_id, JSON.stringify({
        extension_count: (order.extension_count || 0) + 1,
        extension_minutes: extensionMinutes,
      })]);

    } else {
      // Decline extension - clear the request and potentially cancel/dispute
      const newExtensionCount = order.extension_count || 0;
      const outcome = getExpiryOutcome(order.status, newExtensionCount, order.max_extensions);

      if (outcome === 'disputed') {
        // Move to dispute
        updatedOrder = await queryOne<Order>(`
          UPDATE orders
          SET extension_requested_by = NULL,
              extension_requested_at = NULL,
              status = 'disputed'
          WHERE id = $1
          RETURNING *
        `, [id]);

        // Log dispute event
        await query(`
          INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
          VALUES ($1, 'status_changed_to_disputed', $2, $3, $4, 'disputed', $5)
        `, [id, 'system', null, order.status, JSON.stringify({
          reason: 'Extension declined after max extensions reached',
        })]);

        // Notify about dispute
        notifyOrderStatusUpdated({
          orderId: id,
          userId: order.user_id,
          merchantId: order.merchant_id,
          status: 'disputed' as OrderStatus,
          previousStatus: order.status,
          updatedAt: new Date().toISOString(),
        });

      } else {
        // Move to cancelled
        updatedOrder = await queryOne<Order>(`
          UPDATE orders
          SET extension_requested_by = NULL,
              extension_requested_at = NULL,
              status = 'cancelled',
              cancelled_at = NOW(),
              cancelled_by = $2,
              cancellation_reason = 'Extension declined'
          WHERE id = $1
          RETURNING *
        `, [id, actor_type]);

        // Log cancellation event
        await query(`
          INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
          VALUES ($1, 'status_changed_to_cancelled', $2, $3, $4, 'cancelled', $5)
        `, [id, actor_type, actor_id, order.status, JSON.stringify({
          reason: 'Extension declined',
        })]);

        // Notify about cancellation
        notifyOrderStatusUpdated({
          orderId: id,
          userId: order.user_id,
          merchantId: order.merchant_id,
          status: 'cancelled' as OrderStatus,
          previousStatus: order.status,
          updatedAt: new Date().toISOString(),
        });
      }

      // Log decline event
      await query(`
        INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
        VALUES ($1, 'extension_declined', $2, $3, $4)
      `, [id, actor_type, actor_id, JSON.stringify({
        outcome,
      })]);
    }

    // Notify about extension response
    notifyExtensionResponse({
      orderId: id,
      userId: order.user_id,
      merchantId: order.merchant_id,
      accepted: accept,
      respondedBy: actor_type as ActorType,
      newExpiresAt: updatedOrder?.expires_at?.toISOString(),
      newStatus: updatedOrder?.status,
    });

    logger.api.request('PUT', `/api/orders/${id}/extension`, actor_id);
    return successResponse({
      ...updatedOrder,
      message: accept ? 'Extension accepted' : 'Extension declined',
    });
  } catch (error) {
    logger.api.error('PUT', '/api/orders/[id]/extension', error as Error);
    return errorResponse('Internal server error');
  }
}

// GET - Get extension status for an order
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const order = await queryOne<Order>(
      'SELECT * FROM orders WHERE id = $1',
      [id]
    );

    if (!order) {
      return notFoundResponse('Order');
    }

    const extensionCheck = canExtendOrder(
      order.status,
      order.extension_count,
      order.max_extensions
    );

    return successResponse({
      canExtend: extensionCheck.canExtend,
      reason: extensionCheck.reason,
      extensionCount: order.extension_count,
      maxExtensions: order.max_extensions,
      extensionsRemaining: order.max_extensions - order.extension_count,
      pendingRequest: order.extension_requested_by ? {
        requestedBy: order.extension_requested_by,
        requestedAt: order.extension_requested_at,
        extensionMinutes: order.extension_minutes,
      } : null,
      extensionDuration: getExtensionDuration(order.status),
    });
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/extension', error as Error);
    return errorResponse('Internal server error');
  }
}
