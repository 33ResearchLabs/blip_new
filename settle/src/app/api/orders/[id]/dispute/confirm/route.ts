import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { notifyOrderStatusUpdated } from '@/lib/pusher/server';

// Confirm or reject a proposed dispute resolution
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;
    const body = await request.json();
    const { party, action, partyId } = body; // party: 'user' | 'merchant', action: 'accept' | 'reject'

    if (!party || !action || !partyId) {
      return NextResponse.json(
        { success: false, error: 'Party, action, and partyId are required' },
        { status: 400 }
      );
    }

    if (!['user', 'merchant'].includes(party)) {
      return NextResponse.json(
        { success: false, error: 'Invalid party type' },
        { status: 400 }
      );
    }

    if (!['accept', 'reject'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Action must be accept or reject' },
        { status: 400 }
      );
    }

    // Get the dispute
    const disputeResult = await query(
      `SELECT d.*, o.user_id, o.merchant_id
       FROM disputes d
       JOIN orders o ON d.order_id = o.id
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
      proposed_resolution: string;
      user_confirmed: boolean;
      merchant_confirmed: boolean;
      user_id: string;
      merchant_id: string;
      resolution_notes: string;
      split_percentage: string;
    };

    if (dispute.status !== 'pending_confirmation') {
      return NextResponse.json(
        { success: false, error: 'No pending resolution to confirm' },
        { status: 400 }
      );
    }

    // Verify the party is actually part of this order
    if (party === 'user' && partyId !== dispute.user_id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 403 }
      );
    }
    if (party === 'merchant' && partyId !== dispute.merchant_id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 403 }
      );
    }

    if (action === 'reject') {
      // If either party rejects, go back to investigating
      await query(
        `UPDATE disputes
         SET status = 'investigating'::dispute_status,
             proposed_resolution = NULL,
             user_confirmed = false,
             merchant_confirmed = false
         WHERE order_id = $1`,
        [orderId]
      );

      // Add message about rejection (use chat_messages table)
      try {
        await query(
          `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, created_at)
           VALUES ($1, $2::actor_type, $3, $4, 'system'::message_type, NOW())`,
          [orderId, party, partyId, JSON.stringify({ type: 'resolution_rejected', party })]
        );
      } catch (msgErr) {
        console.log('Chat message insert note:', msgErr);
      }

      return NextResponse.json({
        success: true,
        data: {
          status: 'investigating',
          message: 'Resolution rejected. Case sent back for review.',
        },
      });
    }

    // Accept - update the confirmation for this party
    const updateField = party === 'user' ? 'user_confirmed' : 'merchant_confirmed';
    await query(
      `UPDATE disputes SET ${updateField} = true WHERE order_id = $1`,
      [orderId]
    );

    // Check if both parties have now confirmed
    const updatedDispute = await query(
      `SELECT user_confirmed, merchant_confirmed, proposed_resolution FROM disputes WHERE order_id = $1`,
      [orderId]
    );

    const updated = updatedDispute[0] as {
      user_confirmed: boolean;
      merchant_confirmed: boolean;
      proposed_resolution: string;
    };

    if (updated.user_confirmed && updated.merchant_confirmed) {
      // Both confirmed! Finalize the resolution
      const resolution = updated.proposed_resolution;

      // Get the order details for money release
      const orderResult = await query(
        `SELECT o.*, d.split_percentage
         FROM orders o
         JOIN disputes d ON d.order_id = o.id
         WHERE o.id = $1`,
        [orderId]
      );

      const order = orderResult[0] as {
        crypto_amount: number;
        user_id: string;
        merchant_id: string;
        split_percentage: string | null;
      };

      const amount = parseFloat(String(order.crypto_amount));

      // Release money based on resolution
      let userAmount = 0;
      let merchantAmount = 0;
      let orderStatus = 'completed';

      if (resolution === 'user') {
        // Full refund to user
        userAmount = amount;
        orderStatus = 'cancelled';
      } else if (resolution === 'merchant') {
        // Release to merchant
        merchantAmount = amount;
        orderStatus = 'completed';
      } else if (resolution === 'split') {
        // Split between both parties
        const splitPercentage = order.split_percentage
          ? JSON.parse(order.split_percentage)
          : { user: 50, merchant: 50 };
        userAmount = amount * (splitPercentage.user / 100);
        merchantAmount = amount * (splitPercentage.merchant / 100);
        orderStatus = 'completed';
      }

      // Update user balance if they get money
      if (userAmount > 0) {
        await query(
          `UPDATE users SET balance = balance + $1 WHERE id = $2`,
          [userAmount, order.user_id]
        );
      }

      // Update merchant balance if they get money
      if (merchantAmount > 0) {
        await query(
          `UPDATE merchants SET balance = balance + $1 WHERE id = $2`,
          [merchantAmount, order.merchant_id]
        );
      }

      // Update dispute to resolved (use 'resolved' status since custom statuses might not exist)
      await query(
        `UPDATE disputes
         SET status = 'resolved'::dispute_status,
             resolution = $1,
             resolved_at = NOW()
         WHERE order_id = $2`,
        [resolution, orderId]
      );

      // Update order status
      await query(
        `UPDATE orders SET status = $1::order_status WHERE id = $2`,
        [orderStatus, orderId]
      );

      // Notify all parties about the resolution via Pusher
      await notifyOrderStatusUpdated({
        orderId,
        userId: dispute.user_id,
        merchantId: dispute.merchant_id,
        status: orderStatus,
        previousStatus: 'disputed',
        updatedAt: new Date().toISOString(),
      });

      // Add message about final resolution with money transfer details
      try {
        await query(
          `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, created_at)
           VALUES ($1, 'system'::actor_type, NULL, $2, 'system'::message_type, NOW())`,
          [orderId, JSON.stringify({
            type: 'resolution_finalized',
            resolution,
            userAmount,
            merchantAmount,
            totalAmount: amount,
          })]
        );
      } catch (msgErr) {
        console.log('Chat message insert note:', msgErr);
      }

      return NextResponse.json({
        success: true,
        data: {
          status: `resolved_${resolution}`,
          orderStatus,
          message: 'Both parties confirmed. Resolution finalized.',
          finalized: true,
          moneyReleased: {
            user: userAmount,
            merchant: merchantAmount,
            total: amount,
          },
        },
      });
    }

    // Only one party confirmed so far
    // Add message about acceptance (use chat_messages table)
    try {
      await query(
        `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, created_at)
         VALUES ($1, $2::actor_type, $3, $4, 'system'::message_type, NOW())`,
        [orderId, party, partyId, JSON.stringify({ type: 'resolution_accepted', party })]
      );
    } catch (msgErr) {
      console.log('Chat message insert note:', msgErr);
    }

    return NextResponse.json({
      success: true,
      data: {
        status: 'pending_confirmation',
        userConfirmed: party === 'user' ? true : dispute.user_confirmed,
        merchantConfirmed: party === 'merchant' ? true : dispute.merchant_confirmed,
        message: `${party === 'user' ? 'User' : 'Merchant'} confirmed. Waiting for other party.`,
        finalized: false,
      },
    });
  } catch (error) {
    console.error('Failed to confirm resolution:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to confirm resolution', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
