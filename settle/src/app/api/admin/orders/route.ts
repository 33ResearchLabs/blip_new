import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

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
  user_name: string;
  merchant_name: string;
  buyer_merchant_name: string | null;
}

// GET /api/admin/orders - Get all orders for admin monitoring
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // Optional: filter by status
    const limit = parseInt(searchParams.get('limit') || '50');
    const minAmount = searchParams.get('min_amount'); // For big transactions

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
        COALESCE(u.username, 'Unknown User') as user_name,
        COALESCE(m.business_name, 'Unknown Merchant') as merchant_name,
        bm.business_name as buyer_merchant_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN merchants m ON o.merchant_id = m.id
      LEFT JOIN merchants bm ON o.buyer_merchant_id = bm.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex}
    `, params);

    // Transform to frontend format
    const formattedOrders = orders.map(order => ({
      id: order.id,
      orderNumber: order.order_number,
      user: order.user_name,
      merchant: order.merchant_name,
      buyerMerchant: order.buyer_merchant_name || null,
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
    }));

    return NextResponse.json({ success: true, data: formattedOrders });
  } catch (error) {
    console.error('Error fetching admin orders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}
