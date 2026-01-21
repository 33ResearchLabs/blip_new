import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Create a dispute for an order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;
    const body = await request.json();
    const { reason, description, initiated_by, user_id, merchant_id } = body;

    if (!reason) {
      return NextResponse.json(
        { success: false, error: 'Reason is required' },
        { status: 400 }
      );
    }

    if (!initiated_by || !['user', 'merchant'].includes(initiated_by)) {
      return NextResponse.json(
        { success: false, error: 'initiated_by must be user or merchant' },
        { status: 400 }
      );
    }

    // Check if order exists
    const orderResult = await query(
      `SELECT id, status, user_id, merchant_id FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderResult.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    const order = orderResult[0] as { id: string; status: string; user_id: string; merchant_id: string };

    // Check if order is already disputed
    if (order.status === 'disputed') {
      return NextResponse.json(
        { success: false, error: 'Order is already disputed' },
        { status: 400 }
      );
    }

    // Check if dispute already exists
    const existingDispute = await query(
      `SELECT id FROM disputes WHERE order_id = $1`,
      [orderId]
    );

    if (existingDispute.length > 0) {
      return NextResponse.json(
        { success: false, error: 'Dispute already exists for this order' },
        { status: 400 }
      );
    }

    // Get the actor ID
    const actorId = initiated_by === 'user'
      ? (user_id || order.user_id)
      : (merchant_id || order.merchant_id);

    if (!actorId) {
      return NextResponse.json(
        { success: false, error: 'Could not determine actor ID' },
        { status: 400 }
      );
    }

    // Ensure disputes table has the confirmation columns (run migration inline)
    try {
      await query(`
        ALTER TABLE disputes
        ADD COLUMN IF NOT EXISTS proposed_resolution VARCHAR(50),
        ADD COLUMN IF NOT EXISTS proposed_by UUID,
        ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
        ADD COLUMN IF NOT EXISTS user_confirmed BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS merchant_confirmed BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS split_percentage JSONB,
        ADD COLUMN IF NOT EXISTS assigned_to UUID
      `);
    } catch (alterErr) {
      // Columns might already exist, that's OK
      console.log('Alter table note:', alterErr);
    }

    // Insert the dispute
    const disputeResult = await query(
      `INSERT INTO disputes (
        order_id, reason, description, raised_by, raiser_id, status,
        user_confirmed, merchant_confirmed, created_at
      )
       VALUES ($1, $2::dispute_reason, $3, $4::actor_type, $5, 'open'::dispute_status, false, false, NOW())
       RETURNING *`,
      [orderId, reason, description || '', initiated_by, actorId]
    );

    // Update order status to disputed
    await query(
      `UPDATE orders SET status = 'disputed'::order_status WHERE id = $1`,
      [orderId]
    );

    // Insert chat message about the dispute (use chat_messages table)
    try {
      await query(
        `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, created_at)
         VALUES ($1, $2::actor_type, $3, $4, 'system'::message_type, NOW())`,
        [orderId, initiated_by, actorId, JSON.stringify({ reason, description, type: 'dispute_opened' })]
      );
    } catch (msgErr) {
      // Chat message is optional, don't fail the whole request
      console.log('Chat message insert note:', msgErr);
    }

    return NextResponse.json({
      success: true,
      data: disputeResult[0],
    });
  } catch (error) {
    console.error('Failed to create dispute:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create dispute', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Get dispute for an order
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;

    const result = await query(
      `SELECT d.*, o.order_number, o.crypto_amount, o.fiat_amount
       FROM disputes d
       JOIN orders o ON d.order_id = o.id
       WHERE d.order_id = $1`,
      [orderId]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No dispute found for this order' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result[0],
    });
  } catch (error) {
    console.error('Failed to get dispute:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get dispute' },
      { status: 500 }
    );
  }
}
