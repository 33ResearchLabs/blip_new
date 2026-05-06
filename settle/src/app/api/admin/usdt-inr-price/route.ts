import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import {
  getPriceData,
  getPairConfig,
  isValidTimeframe,
  SUPPORTED_PAIRS,
  TIMEFRAMES,
  type Timeframe,
} from '@/lib/price/usdtInrPrice';

// GET /api/admin/usdt-inr-price?pair=usdt_inr&timeframe=5m
export async function GET(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const pairId = searchParams.get('pair') || 'usdt_inr';
    const tf = searchParams.get('timeframe') || '5m';

    if (!getPairConfig(pairId)) {
      return NextResponse.json(
        { success: false, error: `Unsupported pair: ${pairId}. Supported: ${SUPPORTED_PAIRS.map((p) => p.id).join(', ')}` },
        { status: 400 },
      );
    }

    if (!isValidTimeframe(tf)) {
      return NextResponse.json(
        { success: false, error: `Invalid timeframe: ${tf}. Supported: ${Object.keys(TIMEFRAMES).join(', ')}` },
        { status: 400 },
      );
    }

    const data = await getPriceData(pairId, tf as Timeframe);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[usdt-inr-price] Failed:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to fetch price data. Please try again.' },
      { status: 502 },
    );
  }
}
