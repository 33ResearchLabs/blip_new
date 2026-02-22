/**
 * Conversion API Route (Settle → Core-API Proxy)
 *
 * POST /api/convert - Convert USDT ↔ sINR
 *
 * Proxies conversion requests to core-api for atomic execution.
 * Handles session extraction and validation before forwarding.
 */

import { NextRequest, NextResponse } from 'next/server';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import { unauthorizedResponse } from '@/lib/middleware/auth';
import { cookies } from 'next/headers';

const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

interface ConvertRequest {
  direction: 'usdt_to_saed' | 'saed_to_usdt';
  amount: number; // In smallest units (micro-USDT or fils)
  accountType?: 'merchant' | 'user';
  accountId?: string;
  idempotencyKey?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ConvertRequest = await request.json();
    const { direction, amount, accountType, accountId, idempotencyKey } = body;

    // Validation
    if (!direction || !amount) {
      return NextResponse.json(
        { success: false, error: 'direction and amount are required' },
        { status: 400 }
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Amount must be positive' },
        { status: 400 }
      );
    }

    if (!['usdt_to_saed', 'saed_to_usdt', 'usdt_to_sinr', 'sinr_to_usdt'].includes(direction)) {
      return NextResponse.json(
        { success: false, error: 'Invalid direction' },
        { status: 400 }
      );
    }

    // Extract account from session or request body
    let effectiveAccountType: 'merchant' | 'user' = accountType || 'merchant';
    let effectiveAccountId: string | undefined = accountId;

    // If not provided in body, try to extract from session
    if (!effectiveAccountId) {
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get('merchant_session');

      if (sessionCookie) {
        try {
          const sessionData = JSON.parse(sessionCookie.value);
          effectiveAccountId = sessionData.merchantId || sessionData.userId;
          effectiveAccountType = sessionData.merchantId ? 'merchant' : 'user';
        } catch (e) {
          // Session parsing failed
        }
      }

      // If still no account ID, return unauthorized
      if (!effectiveAccountId) {
        return unauthorizedResponse('Session required');
      }
    }

    // If in MOCK_MODE or core-api not configured, handle locally
    // For now, always proxy to core-api for consistency
    // Map new saed directions to sinr for backwards compatibility
    const normalizedDirection = direction.replace('saed', 'sinr') as 'usdt_to_sinr' | 'sinr_to_usdt';
    const endpoint = normalizedDirection === 'usdt_to_sinr'
      ? '/v1/convert/usdt-to-sinr'
      : '/v1/convert/sinr-to-usdt';

    const response = await proxyCoreApi(endpoint, {
      method: 'POST',
      body: {
        account_type: effectiveAccountType,
        account_id: effectiveAccountId,
        amount,
        idempotency_key: idempotencyKey,
      },
      actorType: effectiveAccountType,
      actorId: effectiveAccountId,
    });

    // Return the proxied response
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[ConvertAPI] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch current balances and rate
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type') || 'merchant';

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    const table = type === 'merchant' ? 'merchants' : 'users';

    // Import query from DB
    const { query } = await import('@/lib/db');

    const result = await query(
      `SELECT balance, sinr_balance, synthetic_rate, max_sinr_exposure
       FROM ${table}
       WHERE id = $1`,
      [userId]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }

    const account = result[0] as any;
    return NextResponse.json({
      success: true,
      balances: {
        usdt: parseFloat(String(account.balance)),
        saed: Number(account.sinr_balance), // DB column is sinr_balance but return as saed
        rate: parseFloat(String(account.synthetic_rate)),
        maxExposure: account.max_sinr_exposure !== null
          ? Number(account.max_sinr_exposure)
          : null,
      },
    });
  } catch (error) {
    console.error('[ConvertAPI] Error fetching balances:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
