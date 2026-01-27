import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface OrderRow {
  id: string;
  order_number: string;
  user_id: string;
  merchant_id: string;
  crypto_amount: string;
  fiat_amount: string;
  status: string;
  type: string;
  created_at: string;
  expires_at: string;
  user_name: string;
  merchant_name: string;
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
        o.crypto_amount::text,
        o.fiat_amount::text,
        o.status,
        o.type,
        o.created_at::text,
        o.expires_at::text,
        COALESCE(u.username, 'Unknown User') as user_name,
        COALESCE(m.business_name, 'Unknown Merchant') as merchant_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN merchants m ON o.merchant_id = m.id
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
      amount: parseFloat(order.crypto_amount),
      fiatAmount: parseFloat(order.fiat_amount),
      status: order.status,
      type: order.type,
      createdAt: order.created_at,
      expiresAt: order.expires_at,
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
