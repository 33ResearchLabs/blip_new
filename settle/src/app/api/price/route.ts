import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getPriceData, getPairConfig, isValidTimeframe, SUPPORTED_PAIRS, type Timeframe } from '@/lib/price/usdtInrPrice';

// GET /api/price?pair=usdt_inr&timeframe=5m
// Merchant-facing price endpoint (requires auth, not admin-only)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const pairId = searchParams.get('pair') || 'usdt_aed';
    const tf = (searchParams.get('timeframe') || '5m') as string;

    if (!getPairConfig(pairId)) {
      return NextResponse.json(
        { success: false, error: `Unsupported pair. Supported: ${SUPPORTED_PAIRS.map(p => p.id).join(', ')}` },
        { status: 400 },
      );
    }

    if (!isValidTimeframe(tf)) {
      return NextResponse.json(
        { success: false, error: 'Invalid timeframe. Supported: 1m, 5m, 15m, 1h' },
        { status: 400 },
      );
    }

    const data = await getPriceData(pairId, tf as Timeframe);

    return NextResponse.json({
      success: true,
      data: {
        avg_5m: data.avgPrice,
        last_price: data.livePrice,
        currency: pairId === 'usdt_inr' ? 'INR' : 'AED',
        pair: data.pair,
        label: data.label,
        timeframe: data.timeframe,
        tickCount: data.tickCount,
        source: data.source,
      },
    });
  } catch (error) {
    console.error('[price] Failed:', error);
    return NextResponse.json(
      { success: false, error: 'Price data unavailable' },
      { status: 502 },
    );
  }
}
