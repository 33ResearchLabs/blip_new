/**
 * Corridor Availability API
 *
 * GET ?fiat_amount=X&exclude=id1,id2  — Check if LP available for amount
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkCorridorAvailability } from '@/lib/db/repositories/corridor';
import { requireAuth } from '@/lib/middleware/auth';

export async function GET(request: NextRequest) {
  // Require auth to check availability
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const fiatAmountStr = request.nextUrl.searchParams.get('fiat_amount');
  const excludeStr = request.nextUrl.searchParams.get('exclude');

  const fiatAmount = fiatAmountStr ? parseFloat(fiatAmountStr) : 0;
  if (!fiatAmount || fiatAmount <= 0) {
    return NextResponse.json({ success: false, error: 'Valid fiat_amount required' }, { status: 400 });
  }

  const excludeIds = excludeStr ? excludeStr.split(',').filter(Boolean) : [];

  try {
    const result = await checkCorridorAvailability(fiatAmount, excludeIds);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[CorridorAvailability] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
