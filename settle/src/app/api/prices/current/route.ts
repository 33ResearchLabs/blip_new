import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getFinalPrice, getPairConfig, SUPPORTED_PAIRS } from '@/lib/price/usdtInrPrice';
import { getCurrentFeeBps } from '@/lib/money/feeBps';

// GET /api/prices/current?pair=usdt_inr
//
// Single source of truth. Returns the final price based on admin mode
// (LIVE or MANUAL) AND the current protocol fee in basis points. The UI
// snapshots `{ price, feeBps }` into the order at creation time so the
// fiat + payout numbers it displays are deterministic end-to-end.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const pairId = searchParams.get('pair') || 'usdt_aed';

    if (!getPairConfig(pairId)) {
      return NextResponse.json(
        { success: false, error: `Unsupported pair. Supported: ${SUPPORTED_PAIRS.map(p => p.id).join(', ')}` },
        { status: 400 },
      );
    }

    const [data, feeBps] = await Promise.all([
      getFinalPrice(pairId),
      getCurrentFeeBps(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        pair: data.pair,
        label: data.label,
        price: data.price,
        mode: data.mode,
        livePrice: data.livePrice,
        adminPrice: data.adminPrice,
        currency: pairId === 'usdt_inr' ? 'INR' : 'AED',
        feeBps,
      },
    });
  } catch (error) {
    console.error('[prices/current] Failed:', error);
    return NextResponse.json(
      { success: false, error: 'Price unavailable' },
      { status: 502 },
    );
  }
}
