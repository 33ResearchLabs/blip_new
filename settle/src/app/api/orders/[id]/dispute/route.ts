import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { proxyCoreApi } from '@/lib/proxy/coreApi';

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

    const actorId = initiated_by === 'user'
      ? (user_id || '')
      : (merchant_id || '');
    return proxyCoreApi(`/v1/orders/${orderId}/dispute`, {
      method: 'POST',
      body: { reason, description, initiated_by, actor_id: actorId },
    });
  } catch (error) {
    console.error('Failed to create dispute:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create dispute', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Get dispute for an order (read-only, stays local)
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
