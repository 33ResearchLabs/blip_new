import { NextRequest, NextResponse } from 'next/server';
import { getMerchantOrders } from '@/lib/db/repositories/orders';
import { logger } from '@/lib/logger';
import { serializeOrders } from '@/lib/api/orderSerializer';
import { getAuthContext } from '@/lib/middleware/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ merchantId: string }> }
) {
  try {
    const { merchantId } = await params;

    if (!merchantId) {
      return NextResponse.json(
        { success: false, error: 'Merchant ID is required' },
        { status: 400 }
      );
    }

    // Verify the requester is authorized to view this merchant's orders
    const auth = getAuthContext(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }
    // Merchants can only view their own orders via this endpoint
    if (auth.actorType === 'merchant' && auth.actorId !== merchantId) {
      return NextResponse.json(
        { success: false, error: 'Access denied' },
        { status: 403 }
      );
    }

    const orders = await getMerchantOrders(merchantId);

    logger.api.request('GET', `/api/merchants/${merchantId}/orders`, merchantId);

    return NextResponse.json({
      success: true,
      data: serializeOrders(orders || []),
    });
  } catch (error) {
    logger.api.error('GET', '/api/merchants/[merchantId]/orders', error as Error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch merchant orders' },
      { status: 500 }
    );
  }
}
