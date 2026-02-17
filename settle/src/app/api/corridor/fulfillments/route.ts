/**
 * Corridor Fulfillments API
 *
 * GET ?provider_merchant_id=X  — LP's active assignments
 * GET ?order_id=X              — Get fulfillment for an order
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveFulfillmentsForProvider,
  getFulfillmentByOrderId,
} from '@/lib/db/repositories/corridor';

export async function GET(request: NextRequest) {
  const providerMerchantId = request.nextUrl.searchParams.get('provider_merchant_id');
  const orderId = request.nextUrl.searchParams.get('order_id');

  try {
    if (providerMerchantId) {
      const fulfillments = await getActiveFulfillmentsForProvider(providerMerchantId);
      return NextResponse.json({ success: true, data: fulfillments });
    }

    if (orderId) {
      const fulfillment = await getFulfillmentByOrderId(orderId);
      return NextResponse.json({ success: true, data: fulfillment });
    }

    return NextResponse.json(
      { success: false, error: 'provider_merchant_id or order_id required' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[CorridorFulfillments] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
