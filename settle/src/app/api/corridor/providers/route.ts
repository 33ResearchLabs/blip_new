/**
 * Corridor Providers API
 *
 * GET  ?merchant_id=X  — Get provider config for a merchant
 * POST                 — Register/update as LP
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProviderByMerchantId, upsertProvider } from '@/lib/db/repositories/corridor';
import { requireAuth, forbiddenResponse } from '@/lib/middleware/auth';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';

export async function GET(request: NextRequest) {
  // Require auth to view provider config
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

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
  // Rate limit provider updates
  const rl = await checkRateLimit(request, 'corridor:providers', STANDARD_LIMIT);
  if (rl) return rl;

  // Require DB-verified auth
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { merchant_id, is_active, fee_percentage, min_amount, max_amount, auto_accept } = body;

    if (!merchant_id) {
      return NextResponse.json({ success: false, error: 'merchant_id required' }, { status: 400 });
    }

    // Only the merchant themselves or system can update their provider config
    if (auth.actorType === 'merchant' && auth.actorId !== merchant_id) {
      return forbiddenResponse('You can only manage your own provider config');
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
