import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getFinalPrice, getPriceData, getPairConfig, isValidTimeframe, SUPPORTED_PAIRS, type Timeframe } from '@/lib/price/usdtInrPrice';

// GET /api/price?pair=usdt_inr&timeframe=5m
// Merchant-facing price endpoint. Returns:
//   - final_price: the price admin has chosen (LIVE or MANUAL) — use this for display
//   - avg_5m / last_price / history: tick data for the market panel
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

    // Fetch tick data + final price in parallel
    const [tickData, finalData] = await Promise.all([
      getPriceData(pairId, tf as Timeframe),
      getFinalPrice(pairId),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        // Final price — single source of truth
        final_price: finalData.price,
        price_mode: finalData.mode,
        // Tick-based data for market reference
        avg_5m: tickData.avgPrice,
        last_price: tickData.livePrice,
        currency: pairId === 'usdt_inr' ? 'INR' : 'AED',
        pair: tickData.pair,
        label: tickData.label,
        timeframe: tickData.timeframe,
        tickCount: tickData.tickCount,
        source: tickData.source,
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
