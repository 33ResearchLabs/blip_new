import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { requireAuth } from '@/lib/middleware/auth';
import { auditLog } from '@/lib/auditLog';

/** Format millisecond delta to human-readable string */
function formatDelta(ms: number): string {
  if (ms < 1000) return '<1s';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
  const days = Math.floor(hr / 24);
  const remHr = hr % 24;
  return remHr > 0 ? `${days}d ${remHr}h` : `${days}d`;
}

// Get all disputed orders for compliance dashboard
export async function GET(request: NextRequest) {
  // Require DB-verified compliance or system actor type OR merchant with has_compliance_access
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let hasAccess = auth.actorType === 'compliance' || auth.actorType === 'system';

  // Check merchant compliance access flag (like ops access)
  if (!hasAccess && auth.actorType === 'merchant' && auth.merchantId) {
    const merchant = await queryOne<{ has_compliance_access: boolean }>(
      `SELECT has_compliance_access FROM merchants WHERE id = $1 AND status = 'active'`,
      [auth.merchantId]
    );
    if (merchant?.has_compliance_access) hasAccess = true;
  }

  if (!hasAccess) {
    return NextResponse.json(
      { success: false, error: 'Compliance authentication required' },
      { status: 403 }
    );
  }

  // Audit log: track who is accessing dispute data
  auditLog('compliance.dispute_accessed', auth.actorId, auth.actorType, undefined, {
    merchantId: auth.merchantId,
    endpoint: 'GET /api/compliance/disputes',
  });

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
        d.raised_by,
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
        m.total_trades as merchant_trades,
        o.buyer_merchant_id,
        bm.display_name as buyer_merchant_name,
        bm.wallet_address as buyer_merchant_wallet,
        bm.rating as buyer_merchant_rating,
        bm.total_trades as buyer_merchant_trades
      FROM orders o
      LEFT JOIN disputes d ON d.order_id = o.id
      JOIN users u ON o.user_id = u.id
      JOIN merchants m ON o.merchant_id = m.id
      LEFT JOIN merchants bm ON o.buyer_merchant_id = bm.id
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

    // Fetch lifecycle events for all disputed orders in one query
    const orderIds = (result as any[]).map(r => r.id);
    const lifecycleEvents = orderIds.length > 0
      ? await query(
          `SELECT order_id, event_type, old_status, new_status, actor_type, actor_id, created_at
           FROM order_events
           WHERE order_id = ANY($1)
           ORDER BY order_id, created_at ASC`,
          [orderIds]
        )
      : [];

    // Group events by order_id
    const lifecycleByOrder: Record<string, any[]> = {};
    for (const ev of lifecycleEvents as any[]) {
      if (!lifecycleByOrder[ev.order_id]) lifecycleByOrder[ev.order_id] = [];
      lifecycleByOrder[ev.order_id].push(ev);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const disputes = (result as any[]).map(row => {
      // Build lifecycle timeline with time deltas
      const events = lifecycleByOrder[row.id] || [];
      const lifecycle = events.map((ev: any, i: number) => {
        const prevTime = i === 0 ? new Date(row.created_at) : new Date(events[i - 1].created_at);
        const currTime = new Date(ev.created_at);
        const deltaMs = currTime.getTime() - prevTime.getTime();

        return {
          status: ev.new_status,
          fromStatus: ev.old_status || (i === 0 ? 'created' : null),
          actorType: ev.actor_type,
          timestamp: ev.created_at,
          deltaMs,
          deltaFormatted: formatDelta(deltaMs),
        };
      });

      // Add the initial "created" step
      lifecycle.unshift({
        status: 'created',
        fromStatus: null,
        actorType: 'system',
        timestamp: row.created_at,
        deltaMs: 0,
        deltaFormatted: '',
      });

      return {
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
        lifecycle,
        dispute: row.dispute_id ? {
          id: row.dispute_id,
          status: row.dispute_status,
          reason: row.dispute_reason,
          description: row.dispute_description,
          initiatedBy: row.raised_by,
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
        buyerMerchant: row.buyer_merchant_id ? {
          id: row.buyer_merchant_id,
          name: row.buyer_merchant_name,
          wallet: row.buyer_merchant_wallet,
          rating: parseFloat(row.buyer_merchant_rating || '0'),
          trades: row.buyer_merchant_trades || 0,
        } : null,
      };
    });

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
