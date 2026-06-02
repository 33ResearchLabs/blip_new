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

    // Optional order_type param so client gets the exact spread-adjusted rate.
    const orderType = searchParams.get('order_type'); // 'buy' | 'sell' | null

    const [data, feeBps] = await Promise.all([
      getFinalPrice(pairId),
      getCurrentFeeBps(),
    ]);

    // 0.5% spread: BUY orders (user buying USDT from merchant) priced above mid;
    // SELL orders (user selling USDT to merchant) priced below mid.
    const SPREAD = 0.005;
    const adjustedPrice =
      orderType === 'buy'  ? data.price * (1 + SPREAD) :
      orderType === 'sell' ? data.price * (1 - SPREAD) :
      data.price;

    return NextResponse.json({
      success: true,
      data: {
        pair: data.pair,
        label: data.label,
        price: adjustedPrice,
        basePrice: data.price,
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
