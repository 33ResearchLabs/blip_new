import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { setPriceConfig, getPriceConfig, getPairConfig, SUPPORTED_PAIRS, type PriceMode } from '@/lib/price/usdtInrPrice';

// GET /api/admin/set-price-mode?pair=usdt_inr
// Returns the current price mode + admin_price for a pair (admin-authed).
// The public /api/prices/current endpoint uses requireAuth (user/merchant only),
// so admin tokens cannot read it from the admin price page — this is the
// admin-side counterpart for restoring state on page refresh.
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const pair = searchParams.get('pair') || 'usdt_inr';

    if (!getPairConfig(pair)) {
      return NextResponse.json(
        { success: false, error: `Unsupported pair. Supported: ${SUPPORTED_PAIRS.map(p => p.id).join(', ')}` },
        { status: 400 },
      );
    }

    const config = await getPriceConfig(pair);
    const mode: PriceMode = (config?.price_mode as PriceMode) || 'LIVE';
    const adminPrice = config?.admin_price ? parseFloat(config.admin_price) : null;

    return NextResponse.json({
      success: true,
      data: {
        pair,
        mode,
        adminPrice,
        updatedAt: config?.updated_at || null,
        updatedBy: config?.updated_by || null,
      },
    });
  } catch (error) {
    console.error('[set-price-mode GET] Failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to read price mode' },
      { status: 500 },
    );
  }
}

// POST /api/admin/set-price-mode
// Body: { pair: "usdt_inr", price_mode: "MANUAL", admin_price: 83.50 }
export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { pair, price_mode, admin_price } = body;

    if (!pair || !price_mode) {
      return NextResponse.json(
        { success: false, error: 'pair and price_mode are required' },
        { status: 400 },
      );
    }

    if (!getPairConfig(pair)) {
      return NextResponse.json(
        { success: false, error: `Unsupported pair. Supported: ${SUPPORTED_PAIRS.map(p => p.id).join(', ')}` },
        { status: 400 },
      );
    }

    if (!['LIVE', 'MANUAL'].includes(price_mode)) {
      return NextResponse.json(
        { success: false, error: 'price_mode must be LIVE or MANUAL' },
        { status: 400 },
      );
    }

    if (price_mode === 'MANUAL') {
      if (typeof admin_price !== 'number' || admin_price <= 0) {
        return NextResponse.json(
          { success: false, error: 'admin_price must be a positive number when mode is MANUAL' },
          { status: 400 },
        );
      }
    }

    const adminUser = request.headers.get('authorization')?.slice(0, 20) || 'admin';
    await setPriceConfig(pair, price_mode as PriceMode, price_mode === 'MANUAL' ? admin_price : null, adminUser);

    console.log(`[set-price-mode] ${pair}: ${price_mode}${price_mode === 'MANUAL' ? ` @ ${admin_price}` : ''}`);

    return NextResponse.json({
      success: true,
      data: { pair, price_mode, admin_price: price_mode === 'MANUAL' ? admin_price : null },
    });
  } catch (error) {
    console.error('[set-price-mode] Failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update price mode' },
      { status: 500 },
    );
  }
}
