import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import { requireAuth, canAccessOrder, forbiddenResponse } from '@/lib/middleware/auth';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';

// Create a dispute for an order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit: 10 dispute operations per minute
  const rateLimitResponse = checkRateLimit(request, 'dispute:create', STRICT_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: orderId } = await params;
    const body = await request.json();

    // Require authentication
    const auth = await requireAuth(request, body);
    if (auth instanceof NextResponse) return auth;

    // Verify access to this order
    const canAccess = await canAccessOrder(auth, orderId);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

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
