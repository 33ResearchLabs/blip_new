import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const merchantId = request.nextUrl.searchParams.get('merchantId');
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50', 10), 100);

    if (!merchantId) {
      return NextResponse.json({ error: 'merchantId required' }, { status: 400 });
    }

    // Fetch recent notifications with order details for richer messages
    const notifications = await query<{
      id: string;
      event_type: string;
      order_id: string;
      payload: any;
      created_at: string;
      status: string;
      crypto_amount: string;
      fiat_amount: string;
      order_type: string;
      order_number: string;
      user_name: string | null;
    }>(
      `SELECT n.id, n.event_type, n.order_id, n.payload, n.created_at, n.status,
              o.crypto_amount::text, o.fiat_amount::text, o.type as order_type, o.order_number,
              u.username as user_name
       FROM notification_outbox n
       JOIN orders o ON n.order_id = o.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.merchant_id = $1 OR o.buyer_merchant_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2`,
      [merchantId, limit]
    );

    return NextResponse.json({ notifications });
  } catch (error) {
    console.error('Failed to fetch notifications:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}
