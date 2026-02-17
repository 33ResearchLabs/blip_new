/**
 * Corridor Providers API
 *
 * GET  ?merchant_id=X  — Get provider config for a merchant
 * POST                 — Register/update as LP
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProviderByMerchantId, upsertProvider } from '@/lib/db/repositories/corridor';

export async function GET(request: NextRequest) {
  const merchantId = request.nextUrl.searchParams.get('merchant_id');
  if (!merchantId) {
    return NextResponse.json({ success: false, error: 'merchant_id required' }, { status: 400 });
  }

  try {
    const provider = await getProviderByMerchantId(merchantId);
    return NextResponse.json({ success: true, data: provider });
  } catch (error) {
    console.error('[CorridorProviders] GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { merchant_id, is_active, fee_percentage, min_amount, max_amount, auto_accept } = body;

    if (!merchant_id) {
      return NextResponse.json({ success: false, error: 'merchant_id required' }, { status: 400 });
    }

    if (fee_percentage != null && (fee_percentage < 0 || fee_percentage > 10)) {
      return NextResponse.json({ success: false, error: 'Fee must be 0-10%' }, { status: 400 });
    }

    const provider = await upsertProvider(merchant_id, {
      is_active: is_active ?? false,
      fee_percentage: fee_percentage ?? 0.5,
      min_amount: min_amount ?? 100,
      max_amount: max_amount ?? 50000,
      auto_accept: auto_accept ?? true,
    });

    return NextResponse.json({ success: true, data: provider });
  } catch (error) {
    console.error('[CorridorProviders] POST error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
