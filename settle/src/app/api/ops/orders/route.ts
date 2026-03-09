import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  const filter = request.nextUrl.searchParams.get('filter') || 'needs_attention';

  try {
    let rows: unknown[];

    if (filter === 'disputed') {
      rows = await query(`
        SELECT o.id, o.order_number, o.status, o.type, o.crypto_amount, o.fiat_amount,
               o.merchant_id, o.buyer_merchant_id, o.user_id, o.order_version,
               o.created_at, o.escrowed_at, o.payment_sent_at, o.expires_at,
               d.id as dispute_id, d.reason as dispute_reason, d.created_at as disputed_at,
               EXTRACT(EPOCH FROM (NOW() - o.created_at))::int as age_sec
        FROM orders o
        LEFT JOIN disputes d ON d.order_id = o.id
        WHERE o.status = 'disputed'
        ORDER BY o.created_at DESC
        LIMIT 100
      `);
    } else if (filter === 'stuck') {
      rows = await query(`
        SELECT id, order_number, status, type, crypto_amount, fiat_amount,
               merchant_id, buyer_merchant_id, user_id, order_version,
               created_at, expires_at,
               EXTRACT(EPOCH FROM (NOW() - created_at))::int as age_sec
        FROM orders
        WHERE status NOT IN ('completed', 'cancelled', 'expired')
          AND expires_at IS NOT NULL
          AND expires_at < NOW()
        ORDER BY expires_at ASC
        LIMIT 100
      `);
    } else {
      // needs_attention: pending/accepted >30m, escrowed/payment_sent >1h, or disputed
      rows = await query(`
        SELECT id, order_number, status, type, crypto_amount, fiat_amount,
               merchant_id, buyer_merchant_id, user_id, order_version,
               created_at, escrowed_at, payment_sent_at, expires_at,
               EXTRACT(EPOCH FROM (NOW() - created_at))::int as age_sec
        FROM orders
        WHERE (
          (status IN ('pending', 'accepted') AND created_at < NOW() - INTERVAL '30 minutes')
          OR (status IN ('escrowed', 'payment_sent', 'payment_confirmed') AND created_at < NOW() - INTERVAL '1 hour')
          OR status = 'disputed'
        )
        AND status NOT IN ('completed', 'cancelled', 'expired')
        ORDER BY created_at ASC
        LIMIT 100
      `);
    }

    return NextResponse.json({ filter, orders: rows, total: (rows as unknown[]).length });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
