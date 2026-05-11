import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { serializeOrders } from '@/lib/api/orderSerializer';
import { requireAdminAuth } from '@/lib/middleware/auth';

interface OrderRow {
  id: string;
  order_number: string;
  user_id: string;
  merchant_id: string;
  buyer_merchant_id: string | null;
  crypto_amount: string;
  fiat_amount: string;
  status: string;
  type: string;
  spread_preference: string | null;
  protocol_fee_percentage: string | null;
  protocol_fee_amount: string | null;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
  user_name: string | null;
  merchant_name: string | null;
  buyer_merchant_name: string | null;
}

// GET /api/admin/orders - Get all orders for admin monitoring
export async function GET(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // Optional: filter by status
    const limit = parseInt(searchParams.get('limit') || '50');
    const minAmount = searchParams.get('min_amount'); // For big transactions
    // Optional timeframe — must match the values the admin dashboard uses
    // for /api/admin/analytics so the orders list and the dashboard's chip
    // counts agree on what "the last 24h" means. Unknown / "all" / missing
    // → no time filter (preserves prior behavior for any older callers).
    const timeframe = searchParams.get('timeframe');
    const TIMEFRAME_INTERVAL: Record<string, string> = {
      '1h': '1 hour',
      '24h': '24 hours',
      '7d': '7 days',
      '1month': '30 days',
    };
    const interval = timeframe ? TIMEFRAME_INTERVAL[timeframe] : undefined;
    // Optional has_escrow filter ('true' / 'false'). Used by the dashboard's
    // Cancelled / Refunded chip split — cancelled+escrow=true is what we call
    // "refunded" (on-chain refund happened); cancelled+escrow=false is a clean
    // cancel with no money moved. Missing / unknown → no additional filter,
    // so existing callers are unaffected.
    const hasEscrowParam = searchParams.get('has_escrow');
    const hasEscrow =
      hasEscrowParam === 'true' ? true :
      hasEscrowParam === 'false' ? false :
      null;

    let whereClause = '';
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      whereClause = `WHERE o.status IN (${statuses.map(() => `$${paramIndex++}`).join(', ')})`;
      params.push(...statuses);
    }

    if (minAmount) {
      const connector = whereClause ? ' AND' : 'WHERE';
      whereClause += `${connector} o.crypto_amount >= $${paramIndex++}`;
      params.push(parseFloat(minAmount));
    }

    if (interval) {
      const connector = whereClause ? ' AND' : 'WHERE';
      // `interval` is one of the hard-coded constants above — never
      // user-supplied — so it's safe to inline here. (Postgres' INTERVAL
      // takes a literal, not a parameter.)
      whereClause += `${connector} o.created_at >= NOW() - INTERVAL '${interval}'`;
    }

    if (hasEscrow !== null) {
      const connector = whereClause ? ' AND' : 'WHERE';
      whereClause += `${connector} o.escrow_tx_hash IS ${hasEscrow ? 'NOT NULL' : 'NULL'}`;
    }

    params.push(limit);

    const orders = await query<OrderRow>(`
      SELECT
        o.id,
        o.order_number,
        o.user_id,
        o.merchant_id,
        o.buyer_merchant_id,
        o.crypto_amount::text,
        o.fiat_amount::text,
        o.status,
        o.type,
        o.spread_preference,
        o.protocol_fee_percentage::text,
        o.protocol_fee_amount::text,
        o.created_at::text,
        o.expires_at::text,
        o.completed_at::text,
        CASE
          WHEN u.username LIKE 'open_order_%' THEN 'Open Order'
          WHEN u.username LIKE 'm2m_%' THEN 'M2M Buyer'
          ELSE COALESCE(NULLIF(u.username, ''), NULLIF(u.name, ''),
                        CASE WHEN o.user_id IS NOT NULL
                             THEN '#' || LEFT(o.user_id::text, 8)
                             ELSE NULL END)
        END as user_name,
        COALESCE(NULLIF(m.display_name, ''), NULLIF(m.business_name, ''),
                 CASE WHEN o.merchant_id IS NOT NULL
                      THEN '#' || LEFT(o.merchant_id::text, 8)
                      ELSE NULL END) as merchant_name,
        COALESCE(NULLIF(bm.display_name, ''), NULLIF(bm.business_name, ''),
                 CASE WHEN o.buyer_merchant_id IS NOT NULL
                      THEN '#' || LEFT(o.buyer_merchant_id::text, 8)
                      ELSE NULL END) as buyer_merchant_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN merchants m ON o.merchant_id = m.id
      LEFT JOIN merchants bm ON o.buyer_merchant_id = bm.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex}
    `, params);

    // Transform to frontend format with minimal_status
    const formattedOrders = serializeOrders(
      orders.map(order => ({
        id: order.id,
        orderNumber: order.order_number,
        user: order.user_name ?? '—',
        merchant: order.merchant_name ?? '—',
        buyerMerchant: order.buyer_merchant_name ?? null,
        amount: parseFloat(order.crypto_amount),
        fiatAmount: parseFloat(order.fiat_amount || '0'),
        status: order.status,
        type: order.type,
        spreadPreference: order.spread_preference,
        feePercentage: order.protocol_fee_percentage ? parseFloat(order.protocol_fee_percentage) : null,
        feeAmount: order.protocol_fee_amount ? parseFloat(order.protocol_fee_amount) : null,
        createdAt: order.created_at,
        expiresAt: order.expires_at,
        completedAt: order.completed_at,
      }))
    );

    return NextResponse.json({ success: true, data: formattedOrders });
  } catch (error) {
    console.error('Error fetching admin orders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}
