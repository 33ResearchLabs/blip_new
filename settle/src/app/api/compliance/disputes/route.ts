import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getAuthContext } from '@/lib/middleware/auth';

// Get all disputed orders for compliance dashboard
export async function GET(request: NextRequest) {
  // Require compliance or system actor type
  const auth = getAuthContext(request);
  if (!auth || (auth.actorType !== 'compliance' && auth.actorType !== 'system')) {
    return NextResponse.json(
      { success: false, error: 'Compliance authentication required' },
      { status: 401 }
    );
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status') || 'all'; // all, disputed, investigating, resolved
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    let statusFilter = '';
    if (status === 'disputed') {
      statusFilter = "AND o.status = 'disputed'";
    } else if (status === 'investigating') {
      statusFilter = "AND d.status = 'investigating'";
    } else if (status === 'resolved') {
      statusFilter = "AND d.status IN ('resolved', 'resolved_user', 'resolved_merchant', 'resolved_split')";
    }

    // Fetch disputed orders with related data
    const result = await query(
      `SELECT
        o.id,
        o.order_number,
        o.type,
        o.payment_method,
        o.crypto_amount,
        o.fiat_amount,
        o.crypto_currency,
        o.fiat_currency,
        o.rate,
        o.status as order_status,
        o.created_at,
        o.expires_at,
        d.id as dispute_id,
        d.status as dispute_status,
        d.reason as dispute_reason,
        d.description as dispute_description,
        d.initiated_by,
        d.created_at as dispute_created_at,
        d.resolved_at,
        d.resolution_notes,
        u.id as user_id,
        u.username as user_name,
        u.wallet_address as user_wallet,
        u.rating as user_rating,
        u.total_trades as user_trades,
        m.id as merchant_id,
        m.display_name as merchant_name,
        m.wallet_address as merchant_wallet,
        m.rating as merchant_rating,
        m.total_trades as merchant_trades
      FROM orders o
      LEFT JOIN disputes d ON d.order_id = o.id
      JOIN users u ON o.user_id = u.id
      JOIN merchants m ON o.merchant_id = m.id
      WHERE (o.status = 'disputed' OR d.id IS NOT NULL)
      ${statusFilter}
      ORDER BY COALESCE(d.created_at, o.created_at) DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total
       FROM orders o
       LEFT JOIN disputes d ON d.order_id = o.id
       WHERE (o.status = 'disputed' OR d.id IS NOT NULL)
       ${statusFilter}`
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const disputes = (result as any[]).map(row => ({
      id: row.id,
      orderNumber: row.order_number,
      type: row.type,
      paymentMethod: row.payment_method,
      cryptoAmount: parseFloat(row.crypto_amount),
      fiatAmount: parseFloat(row.fiat_amount),
      cryptoCurrency: row.crypto_currency,
      fiatCurrency: row.fiat_currency,
      rate: parseFloat(row.rate),
      orderStatus: row.order_status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      dispute: row.dispute_id ? {
        id: row.dispute_id,
        status: row.dispute_status,
        reason: row.dispute_reason,
        description: row.dispute_description,
        initiatedBy: row.initiated_by,
        createdAt: row.dispute_created_at,
        resolvedAt: row.resolved_at,
        resolutionNotes: row.resolution_notes,
      } : null,
      user: {
        id: row.user_id,
        name: row.user_name,
        wallet: row.user_wallet,
        rating: parseFloat(row.user_rating || '0'),
        trades: row.user_trades || 0,
      },
      merchant: {
        id: row.merchant_id,
        name: row.merchant_name,
        wallet: row.merchant_wallet,
        rating: parseFloat(row.merchant_rating || '0'),
        trades: row.merchant_trades || 0,
      },
    }));

    return NextResponse.json({
      success: true,
      data: disputes,
      pagination: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        total: parseInt((countResult as any[])[0]?.total || '0'),
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('Failed to fetch disputes:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch disputes' },
      { status: 500 }
    );
  }
}
