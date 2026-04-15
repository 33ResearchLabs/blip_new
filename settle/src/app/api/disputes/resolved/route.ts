import { NextRequest, NextResponse } from 'next/server';
import { getUserResolvedDisputes, getMerchantResolvedDisputes } from '@/lib/db/repositories/disputes';
import { requireAuth } from '@/lib/middleware/auth';

// GET resolved disputes for a user or merchant
export async function GET(request: NextRequest) {
  try {
    // Authorization check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const searchParams = request.nextUrl.searchParams;
    const actorType = searchParams.get('actor_type'); // 'user' | 'merchant'
    const actorId = searchParams.get('actor_id');

    if (!actorType || !actorId) {
      return NextResponse.json(
        { success: false, error: 'actor_type and actor_id are required' },
        { status: 400 }
      );
    }

    if (!['user', 'merchant'].includes(actorType)) {
      return NextResponse.json(
        { success: false, error: 'Invalid actor_type' },
        { status: 400 }
      );
    }

    // Verify the requester is accessing their own disputes
    if (auth.actorType !== 'system' && auth.actorId !== actorId) {
      return NextResponse.json(
        { success: false, error: 'You can only view your own disputes' },
        { status: 403 }
      );
    }

    let disputes;
    if (actorType === 'user') {
      disputes = await getUserResolvedDisputes(actorId);
    } else {
      disputes = await getMerchantResolvedDisputes(actorId);
    }

    // Transform the data for frontend
    const formattedDisputes = disputes.map(d => ({
      id: d.id,
      orderId: d.order_id,
      orderNumber: d.order_number,
      orderType: d.order_type,
      cryptoAmount: parseFloat(String(d.crypto_amount)),
      fiatAmount: parseFloat(String(d.fiat_amount)),
      cryptoCurrency: d.crypto_currency,
      fiatCurrency: d.fiat_currency,
      otherPartyName: d.other_party_name,
      otherPartyId: d.other_party_id,
      reason: d.reason,
      description: d.description,
      resolution: d.resolution,
      resolvedInFavorOf: d.resolved_in_favor_of,
      createdAt: d.created_at,
      resolvedAt: d.resolved_at,
    }));

    return NextResponse.json({
      success: true,
      data: formattedDisputes,
    });
  } catch (error) {
    console.error('Failed to fetch resolved disputes:', error);

    // Distinguish connection-pool timeouts from real errors so the frontend
    // can show a retry hint instead of a scary "failed" message. The pg
    // pool throws "timeout exceeded when trying to connect" when exhausted.
    const errMsg = (error as Error)?.message || '';
    const isPoolTimeout =
      errMsg.includes('timeout exceeded when trying to connect') ||
      errMsg.includes('Connection terminated') ||
      errMsg.includes('ECONNRESET');

    if (isPoolTimeout) {
      return NextResponse.json(
        {
          success: false,
          error: 'Service busy — please retry in a moment',
          code: 'DB_POOL_TIMEOUT',
          retryable: true,
        },
        {
          status: 503,
          headers: { 'Retry-After': '2' },
        }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to fetch resolved disputes' },
      { status: 500 }
    );
  }
}
