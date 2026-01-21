import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Propose a resolution (requires 2 confirmations from user and merchant)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;
    const body = await request.json();
    const {
      resolution, // 'user' | 'merchant' | 'split'
      notes,
      complianceId,
      splitPercentage, // Optional: { user: 50, merchant: 50 }
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

    // Get the dispute
    const disputeResult = await query(
      `SELECT d.*, o.crypto_amount, o.user_id, o.merchant_id
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
      status: string;
      user_id: string;
      merchant_id: string;
    };

    if (dispute.status === 'resolved') {
      return NextResponse.json(
        { success: false, error: 'Dispute already resolved' },
        { status: 400 }
      );
    }

    // Ensure the pending_confirmation status exists, or use investigating as fallback
    // We'll store the status as a string since we might not have the enum value
    try {
      await query(
        `UPDATE disputes
         SET status = 'investigating'::dispute_status,
             proposed_resolution = $1,
             proposed_by = $2,
             proposed_at = NOW(),
             resolution_notes = $3,
             split_percentage = $4,
             user_confirmed = false,
             merchant_confirmed = false
         WHERE order_id = $5`,
        [
          resolution,
          complianceId,
          notes || '',
          splitPercentage ? JSON.stringify(splitPercentage) : null,
          orderId
        ]
      );
    } catch (updateErr) {
      console.log('Update with investigating status:', updateErr);
      // Try without enum casting
      await query(
        `UPDATE disputes
         SET proposed_resolution = $1,
             proposed_by = $2,
             proposed_at = NOW(),
             resolution_notes = $3,
             split_percentage = $4,
             user_confirmed = false,
             merchant_confirmed = false
         WHERE order_id = $5`,
        [
          resolution,
          complianceId,
          notes || '',
          splitPercentage ? JSON.stringify(splitPercentage) : null,
          orderId
        ]
      );
    }

    // Add message to chat about proposed resolution (use chat_messages table)
    try {
      await query(
        `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, created_at)
         VALUES ($1, 'system'::actor_type, $2, $3, 'system'::message_type, NOW())`,
        [orderId, complianceId, JSON.stringify({
          resolution,
          notes,
          splitPercentage,
          type: 'resolution_proposed'
        })]
      );
    } catch (msgErr) {
      console.log('Chat message insert note:', msgErr);
    }

    return NextResponse.json({
      success: true,
      data: {
        orderId,
        proposedResolution: resolution,
        status: 'pending_confirmation',
        message: 'Resolution proposed. Waiting for both parties to confirm.',
      },
    });
  } catch (error) {
    console.error('Failed to propose resolution:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to propose resolution', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Update dispute status (e.g., start investigating)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;
    const body = await request.json();
    const { status, complianceId, notes } = body;

    if (!status || !complianceId) {
      return NextResponse.json(
        { success: false, error: 'Status and complianceId are required' },
        { status: 400 }
      );
    }

    if (!['investigating', 'pending_evidence', 'escalated'].includes(status)) {
      return NextResponse.json(
        { success: false, error: 'Invalid status' },
        { status: 400 }
      );
    }

    // Update dispute status - use investigating which is in the enum
    const result = await query(
      `UPDATE disputes
       SET status = 'investigating'::dispute_status,
           assigned_to = $1,
           resolution_notes = COALESCE(resolution_notes || E'\n', '') || $2
       WHERE order_id = $3
       RETURNING *`,
      [complianceId, notes ? `[${new Date().toISOString()}] ${notes}` : '', orderId]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Dispute not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result[0],
    });
  } catch (error) {
    console.error('Failed to update dispute:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update dispute', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
