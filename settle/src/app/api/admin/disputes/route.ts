import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

// Dispute lifecycle statuses we accept as filter input. Anything else (or
// missing) means "all". 'all' is the documented default to preserve the
// existing no-filter response shape.
const ALLOWED_DISPUTE_STATUS = new Set([
  'all',
  'open',
  'investigating',
  'resolved',
  'escalated',
  'pending_confirmation',
  'resolved_user',
  'resolved_merchant',
  'resolved_split',
]);

// GET /api/admin/disputes — Dispute stats: top disputed merchants & users
//
// Query params (all optional, additive — defaults match prior behavior):
//   limit            number of recent disputes (default 50, max 200)
//   offset           pagination offset (default 0)
//   status           dispute lifecycle status filter (default 'all')
export async function GET(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'));
    const rawStatus = (searchParams.get('status') || 'all').toLowerCase();
    const statusFilter = ALLOWED_DISPUTE_STATUS.has(rawStatus) ? rawStatus : 'all';

    // Top merchants with most disputes against them.
    //
    // Counts disputes where the merchant is on EITHER side of the order —
    // i.e. `merchant_id` (seller) OR `buyer_merchant_id` (M2M buyer). The
    // prior query only matched the seller side and under-counted disputes
    // against active M2M desks (same pattern used by the merchants list
    // API for trades/volume — `(merchant_id = m.id OR buyer_merchant_id =
    // m.id)`).
    const merchantDisputes = await query<{
      merchant_id: string;
      business_name: string;
      email: string;
      dispute_count: string;
      total_trades: string;
      dispute_rate: string;
      total_disputed_amount: string;
      last_disputed_at: string | null;
    }>(`
      SELECT
        m.id as merchant_id,
        m.business_name,
        COALESCE(m.email, '') as email,
        COUNT(*)::text as dispute_count,
        COALESCE(m.total_trades, 0)::text as total_trades,
        CASE WHEN COALESCE(m.total_trades, 0) > 0
          THEN ROUND((COUNT(*)::numeric / m.total_trades) * 100, 1)::text
          ELSE '0'
        END as dispute_rate,
        COALESCE(SUM(o.crypto_amount), 0)::text as total_disputed_amount,
        MAX(o.disputed_at)::text as last_disputed_at
      FROM orders o
      JOIN merchants m
        ON m.id = o.merchant_id OR m.id = o.buyer_merchant_id
      WHERE o.disputed_at IS NOT NULL
      GROUP BY m.id, m.business_name, m.email, m.total_trades
      ORDER BY COUNT(*) DESC, SUM(o.crypto_amount) DESC
      LIMIT 50
    `);

    // Top users with most disputes
    const userDisputes = await query<{
      user_id: string;
      user_name: string;
      email: string;
      dispute_count: string;
      total_trades: string;
      dispute_rate: string;
      total_disputed_amount: string;
      last_disputed_at: string | null;
    }>(`
      SELECT
        u.id as user_id,
        COALESCE(u.name, u.username, 'Unknown') as user_name,
        COALESCE(u.email, '') as email,
        COUNT(*)::text as dispute_count,
        COALESCE(u.total_trades, 0)::text as total_trades,
        CASE WHEN COALESCE(u.total_trades, 0) > 0
          THEN ROUND((COUNT(*)::numeric / u.total_trades) * 100, 1)::text
          ELSE '0'
        END as dispute_rate,
        COALESCE(SUM(o.crypto_amount), 0)::text as total_disputed_amount,
        MAX(o.disputed_at)::text as last_disputed_at
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.disputed_at IS NOT NULL
      GROUP BY u.id, u.name, u.username, u.email, u.total_trades
      ORDER BY COUNT(*) DESC, SUM(o.crypto_amount) DESC
      LIMIT 50
    `);

    // Recent dispute orders with both parties.
    //
    // Key fixes vs. the prior version:
    //  1. LEFT JOIN on users/merchants — the previous INNER JOINs silently
    //     dropped any disputed order where merchant_id was NULL (broadcast)
    //     or the user row was missing (edge cases). Disputes were
    //     invisible in the admin history even though they existed.
    //  2. LATERAL JOIN onto the dedicated `disputes` table — picks the
    //     most-recent dispute row per order so the UI can show the real
    //     dispute reason, resolution status, who it was resolved in favor
    //     of, and the resolution notes (instead of just the order's
    //     cancellation_reason text).
    //  3. Pagination + status filter — pulled from query params with
    //     backward-compatible defaults (limit=50, offset=0, status='all').
    const statusWhereSql = statusFilter === 'all'
      ? ''
      : `AND d.status = $3::public.dispute_status`;

    const recentParams: unknown[] = [limit, offset];
    if (statusFilter !== 'all') recentParams.push(statusFilter);

    const recentDisputes = await query<{
      order_number: string;
      crypto_amount: string;
      status: string;
      disputed_at: string;
      disputed_by: string | null;
      disputed_by_id: string | null;
      user_name: string;
      user_id: string | null;
      merchant_name: string;
      merchant_id: string | null;
      cancellation_reason: string | null;
      dispute_id: string | null;
      dispute_status: string | null;
      dispute_reason: string | null;
      dispute_description: string | null;
      dispute_resolution: string | null;
      dispute_resolution_notes: string | null;
      dispute_resolved_at: string | null;
      dispute_resolved_in_favor_of: string | null;
    }>(`
      SELECT
        o.order_number,
        o.crypto_amount::text,
        o.status,
        o.disputed_at::text,
        o.disputed_by,
        o.disputed_by_id::text,
        COALESCE(u.name, u.username, 'Unknown') as user_name,
        o.user_id::text,
        COALESCE(m.business_name, '—') as merchant_name,
        o.merchant_id::text,
        o.cancellation_reason,
        d.id::text as dispute_id,
        d.status::text as dispute_status,
        d.reason::text as dispute_reason,
        d.description as dispute_description,
        d.resolution as dispute_resolution,
        d.resolution_notes as dispute_resolution_notes,
        d.resolved_at::text as dispute_resolved_at,
        d.resolved_in_favor_of::text as dispute_resolved_in_favor_of
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN merchants m ON m.id = o.merchant_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM disputes
        WHERE order_id = o.id
        ORDER BY created_at DESC
        LIMIT 1
      ) d ON true
      WHERE o.disputed_at IS NOT NULL
        ${statusWhereSql}
      ORDER BY o.disputed_at DESC
      LIMIT $1 OFFSET $2
    `, recentParams);

    // Total count for pagination — uses the same filter so the page
    // numbering reflects the filtered view, not the unfiltered universe.
    const totalCountParams: unknown[] = [];
    let totalCountSql = `
      SELECT COUNT(*)::text as count
      FROM orders o
      WHERE o.disputed_at IS NOT NULL
    `;
    if (statusFilter !== 'all') {
      totalCountSql += ` AND EXISTS (
        SELECT 1 FROM disputes d
        WHERE d.order_id = o.id AND d.status = $1::public.dispute_status
      )`;
      totalCountParams.push(statusFilter);
    }
    const totalCountRow = await queryOne<{ count: string }>(totalCountSql, totalCountParams);
    const recentTotal = parseInt(totalCountRow?.count || '0');

    // Summary stats
    const summary = await query<{
      total_disputes: string;
      total_disputed_volume: string;
      auto_resolved: string;
      active_disputes: string;
    }>(`
      SELECT
        COUNT(*)::text as total_disputes,
        COALESCE(SUM(crypto_amount), 0)::text as total_disputed_volume,
        COUNT(*) FILTER (WHERE status = 'cancelled' AND cancellation_reason ILIKE '%auto%')::text as auto_resolved,
        COUNT(*) FILTER (WHERE status = 'disputed')::text as active_disputes
      FROM orders
      WHERE disputed_at IS NOT NULL
    `);

    return NextResponse.json({
      success: true,
      data: {
        summary: summary[0] ? {
          totalDisputes: parseInt(summary[0].total_disputes),
          totalDisputedVolume: parseFloat(summary[0].total_disputed_volume),
          autoResolved: parseInt(summary[0].auto_resolved),
          activeDisputes: parseInt(summary[0].active_disputes),
        } : { totalDisputes: 0, totalDisputedVolume: 0, autoResolved: 0, activeDisputes: 0 },
        merchants: merchantDisputes.map((m) => ({
          id: m.merchant_id,
          name: m.business_name,
          email: m.email,
          disputeCount: parseInt(m.dispute_count),
          totalTrades: parseInt(m.total_trades),
          disputeRate: parseFloat(m.dispute_rate),
          totalDisputedAmount: parseFloat(m.total_disputed_amount),
          lastDisputedAt: m.last_disputed_at,
        })),
        users: userDisputes.map((u) => ({
          id: u.user_id,
          name: u.user_name,
          email: u.email,
          disputeCount: parseInt(u.dispute_count),
          totalTrades: parseInt(u.total_trades),
          disputeRate: parseFloat(u.dispute_rate),
          totalDisputedAmount: parseFloat(u.total_disputed_amount),
          lastDisputedAt: u.last_disputed_at,
        })),
        recentDisputes: recentDisputes.map((d) => ({
          orderNumber: d.order_number,
          amount: parseFloat(d.crypto_amount),
          status: d.status,
          disputedAt: d.disputed_at,
          disputedBy: d.disputed_by,
          disputedById: d.disputed_by_id,
          userName: d.user_name,
          userId: d.user_id,
          merchantName: d.merchant_name,
          merchantId: d.merchant_id,
          // Existing field — preserved for backward compatibility. UI now
          // prefers `disputeResolutionNotes`/`disputeResolution` if present
          // and falls back to this if not.
          resolution: d.cancellation_reason,
          // New fields sourced from the dedicated `disputes` table.
          disputeId: d.dispute_id,
          disputeStatus: d.dispute_status,
          disputeReason: d.dispute_reason,
          disputeDescription: d.dispute_description,
          disputeResolution: d.dispute_resolution,
          disputeResolutionNotes: d.dispute_resolution_notes,
          disputeResolvedAt: d.dispute_resolved_at,
          disputeResolvedInFavorOf: d.dispute_resolved_in_favor_of,
        })),
        // Pagination metadata for the recent disputes panel. Old clients
        // that ignore these fields keep working exactly as before.
        recentTotal,
        recentLimit: limit,
        recentOffset: offset,
        recentStatusFilter: statusFilter,
      },
    });
  } catch (error) {
    console.error('Error fetching dispute stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch dispute stats' },
      { status: 500 }
    );
  }
}
