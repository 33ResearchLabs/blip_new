import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { updateOrderStatus } from '@/lib/db/repositories/orders';
import { notifyOrderStatusUpdated } from '@/lib/pusher/server';
import { logger } from '@/lib/logger';

/**
 * Finalize a dispute resolution
 *
 * This endpoint allows compliance to forcibly resolve a dispute and
 * update the order status accordingly. The actual on-chain escrow
 * release/refund must be done by the compliance team using a backend
 * wallet or a multi-sig process.
 *
 * Resolution options:
 * - 'user': Release escrow to user (order completed)
 * - 'merchant': Refund escrow to merchant (order cancelled)
 * - 'split': Partial release (requires off-chain coordination)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;
    const body = await request.json();
    const {
      resolution, // 'user' | 'merchant' | 'split'
      complianceId,
      notes,
      release_tx_hash, // Optional: If compliance already released on-chain
      refund_tx_hash,  // Optional: If compliance already refunded on-chain
    } = body;

    if (!resolution || !complianceId) {
      return NextResponse.json(
        { success: false, error: 'Resolution and complianceId are required' },
        { status: 400 }
      );
    }

    if (!['user', 'merchant', 'split'].includes(resolution)) {
      return NextResponse.json(
        { success: false, error: 'Invalid resolution type' },
        { status: 400 }
      );
    }

    // Verify compliance member exists
    const complianceResult = await query(
      `SELECT id, name, role FROM compliance_team WHERE id = $1 AND is_active = true`,
      [complianceId]
    );

    if (complianceResult.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid compliance member' },
        { status: 403 }
      );
    }

    const complianceMember = complianceResult[0] as { id: string; name: string; role: string };

    // Get the dispute and order details
    const disputeResult = await query(
      `SELECT d.*, o.id as order_id, o.status as order_status, o.crypto_amount, o.user_id, o.merchant_id,
              o.escrow_tx_hash, o.escrow_trade_id, o.escrow_trade_pda, o.escrow_pda, o.escrow_creator_wallet,
              u.wallet_address as user_wallet,
              m.wallet_address as merchant_wallet
       FROM disputes d
       JOIN orders o ON d.order_id = o.id
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN merchants m ON o.merchant_id = m.id
       WHERE d.order_id = $1`,
      [orderId]
    );

    if (disputeResult.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Dispute not found' },
        { status: 404 }
      );
    }

    const dispute = disputeResult[0] as {
      id: string;
      status: string;
      order_id: string;
      order_status: string;
      crypto_amount: string;
      user_id: string;
      merchant_id: string;
      escrow_tx_hash: string | null;
      escrow_trade_id: number | null;
      escrow_trade_pda: string | null;
      escrow_pda: string | null;
      escrow_creator_wallet: string | null;
      user_wallet: string | null;
      merchant_wallet: string | null;
    };

    // Only allow finalizing from disputed or investigating status
    if (!['disputed'].includes(dispute.order_status)) {
      return NextResponse.json(
        { success: false, error: `Cannot finalize dispute for order in '${dispute.order_status}' status` },
        { status: 400 }
      );
    }

    // Determine the new order status based on resolution
    let newOrderStatus: 'completed' | 'cancelled';
    let escrowAction: 'release' | 'refund';

    if (resolution === 'user') {
      // User wins - release escrow to user
      newOrderStatus = 'completed';
      escrowAction = 'release';
    } else if (resolution === 'merchant') {
      // Merchant wins - refund escrow to merchant
      newOrderStatus = 'cancelled';
      escrowAction = 'refund';
    } else {
      // Split - handle off-chain, mark as completed
      newOrderStatus = 'completed';
      escrowAction = 'release'; // Partial release handled off-chain
    }

    // Update dispute status to resolved
    await query(
      `UPDATE disputes
       SET status = 'resolved'::dispute_status,
           resolved_by = $1,
           resolved_at = NOW(),
           proposed_resolution = $2,
           resolution_notes = COALESCE(resolution_notes || E'\n', '') || $3
       WHERE order_id = $4`,
      [
        complianceId,
        resolution,
        `[${new Date().toISOString()}] FINALIZED by ${complianceMember.name} (${complianceMember.role}): ${notes || 'No notes'}`,
        orderId
      ]
    );

    // Update order status and record release/refund tx if provided
    const updateFields: string[] = [];
    const updateValues: (string | null)[] = [];
    let paramIndex = 1;

    if (release_tx_hash) {
      updateFields.push(`release_tx_hash = $${paramIndex++}`);
      updateValues.push(release_tx_hash);
    }
    if (refund_tx_hash) {
      updateFields.push(`refund_tx_hash = $${paramIndex++}`);
      updateValues.push(refund_tx_hash);
    }

    if (newOrderStatus === 'completed') {
      updateFields.push(`completed_at = NOW()`);
    } else {
      updateFields.push(`cancelled_at = NOW()`);
    }

    if (updateFields.length > 0) {
      updateValues.push(orderId);
      await query(
        `UPDATE orders SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
        updateValues
      );
    }

    // Update order status via state machine
    const result = await updateOrderStatus(
      orderId,
      newOrderStatus,
      'system', // Compliance acts as system
      complianceId,
      { resolution, notes }
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // Send real-time notification
    if (result.order) {
      notifyOrderStatusUpdated({
        orderId,
        userId: dispute.user_id,
        merchantId: dispute.merchant_id,
        status: newOrderStatus,
        previousStatus: dispute.order_status,
        updatedAt: new Date().toISOString(),
        data: {
          ...result.order,
          dispute_resolution: resolution,
          resolved_by: complianceMember.name,
        },
      });
    }

    // Add system message to chat
    try {
      await query(
        `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, created_at)
         VALUES ($1, 'system'::actor_type, $2, $3, 'system'::message_type, NOW())`,
        [orderId, complianceId, JSON.stringify({
          type: 'dispute_finalized',
          resolution,
          resolvedBy: complianceMember.name,
          escrowAction,
          notes,
        })]
      );
    } catch (msgErr) {
      logger.warn('Failed to add dispute resolution message to chat', { error: msgErr });
    }

    logger.info('Dispute finalized', {
      orderId,
      resolution,
      escrowAction,
      newOrderStatus,
      complianceId,
      complianceName: complianceMember.name,
    });

    return NextResponse.json({
      success: true,
      data: {
        orderId,
        resolution,
        newStatus: newOrderStatus,
        escrowAction,
        message: `Dispute finalized. Order status: ${newOrderStatus}. Escrow action: ${escrowAction}.`,
        // Escrow details for compliance to process on-chain if needed
        escrowDetails: dispute.escrow_tx_hash ? {
          escrow_tx_hash: dispute.escrow_tx_hash,
          escrow_trade_id: dispute.escrow_trade_id,
          escrow_trade_pda: dispute.escrow_trade_pda,
          escrow_pda: dispute.escrow_pda,
          escrow_creator_wallet: dispute.escrow_creator_wallet,
          user_wallet: dispute.user_wallet,
          merchant_wallet: dispute.merchant_wallet,
          crypto_amount: dispute.crypto_amount,
        } : null,
      },
    });
  } catch (error) {
    console.error('Failed to finalize dispute:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to finalize dispute', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
