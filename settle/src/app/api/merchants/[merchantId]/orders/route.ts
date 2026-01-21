import { NextRequest, NextResponse } from 'next/server';
import { getMerchantOrders } from '@/lib/db/repositories/orders';
import { logger } from '@/lib/logger';

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

    const orders = await getMerchantOrders(merchantId);

    logger.api.request('GET', `/api/merchants/${merchantId}/orders`, merchantId);

    return NextResponse.json({
      success: true,
      data: orders || [],
    });
  } catch (error) {
    logger.api.error('GET', '/api/merchants/[merchantId]/orders', error as Error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch merchant orders' },
      { status: 500 }
    );
  }
}
