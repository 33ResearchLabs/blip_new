import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

interface MerchantRow {
  id: string;
  business_name: string;
  display_name: string;
  email: string;
  phone: string | null;
  status: string;
  is_online: boolean;
  rating: string;
  rating_count: string;
  total_trades: string;
  total_volume: string;
  completed_count: string;
  cancelled_count: string;
  disputed_count: string;
  avg_response_time_mins: string;
  verification_level: string;
  auto_accept_enabled: boolean;
  balance: string;
  sinr_balance: string;
  last_seen_at: string | null;
  created_at: string;
  has_ops_access: boolean;
  has_compliance_access: boolean;
}

const SORT_COLUMNS: Record<string, string> = {
  volume: 'total_volume DESC',
  trades: 'total_trades DESC',
  rating: 'm.rating DESC NULLS LAST',
  completed: 'completed_count DESC',
  cancelled: 'cancelled_count DESC',
  disputed: 'disputed_count DESC',
  response_time: 'm.avg_response_time_mins ASC NULLS LAST',
  balance: 'm.balance DESC',
  newest: 'm.created_at DESC',
  oldest: 'm.created_at ASC',
  name: 'm.business_name ASC',
  status: 'm.status ASC',
  online: 'm.is_online DESC',
};

// GET /api/admin/merchants - Get all merchants with stats
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const sortBy = searchParams.get('sort') || 'volume';
    const statusFilter = searchParams.get('status'); // active, suspended, banned, pending
    const onlineFilter = searchParams.get('online'); // true, false
    const searchQuery = searchParams.get('search');

    const orderClause = `ORDER BY ${SORT_COLUMNS[sortBy] || SORT_COLUMNS.volume}`;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 0;

    if (statusFilter) {
      paramIdx++;
      conditions.push(`m.status = $${paramIdx}`);
      params.push(statusFilter);
    }
    if (onlineFilter === 'true') {
      conditions.push('m.is_online = true');
    } else if (onlineFilter === 'false') {
      conditions.push('m.is_online = false');
    }
    if (searchQuery) {
      paramIdx++;
      conditions.push(`(m.business_name ILIKE $${paramIdx} OR m.display_name ILIKE $${paramIdx} OR m.email ILIKE $${paramIdx} OR m.id::text ILIKE $${paramIdx})`);
      params.push(`%${searchQuery}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    paramIdx++;
    const limitParam = paramIdx;
    params.push(limit);
    paramIdx++;
    const offsetParam = paramIdx;
    params.push(offset);

    const merchants = await query<MerchantRow>(`
      SELECT
        m.id,
        m.business_name,
        COALESCE(m.display_name, m.business_name) as display_name,
        COALESCE(m.email, '') as email,
        m.phone,
        m.status,
        m.is_online,
        COALESCE(m.rating, 0)::text as rating,
        COALESCE(m.rating_count, 0)::text as rating_count,
        COALESCE(m.total_trades, 0)::text as total_trades,
        COALESCE(
          (SELECT SUM(crypto_amount) FROM orders WHERE merchant_id = m.id AND status = 'completed'),
          0
        )::text as total_volume,
        COALESCE(
          (SELECT COUNT(*) FROM orders WHERE merchant_id = m.id AND status = 'completed'),
          0
        )::text as completed_count,
        COALESCE(
          (SELECT COUNT(*) FROM orders WHERE merchant_id = m.id AND status = 'cancelled'),
          0
        )::text as cancelled_count,
        COALESCE(
          (SELECT COUNT(*) FROM orders WHERE merchant_id = m.id AND status = 'disputed'),
          0
        )::text as disputed_count,
        COALESCE(m.avg_response_time_mins, 0)::text as avg_response_time_mins,
        COALESCE(m.verification_level, 0)::text as verification_level,
        COALESCE(m.auto_accept_enabled, false) as auto_accept_enabled,
        COALESCE(m.balance, 0)::text as balance,
        COALESCE(m.sinr_balance, 0)::text as sinr_balance,
        m.last_seen_at::text,
        m.created_at::text,
        m.has_ops_access,
        COALESCE(m.has_compliance_access, false) as has_compliance_access
      FROM merchants m
      ${whereClause}
      ${orderClause}
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, params);

    // Get total count for pagination
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM merchants m ${whereClause}`,
      params.slice(0, params.length - 2) // exclude limit/offset
    );

    const emojis = ['🏪', '💎', '👑', '🛡️', '⚡', '🌟', '💰', '🔥', '🦊', '🐋'];
    const formattedMerchants = merchants.map((merchant, i) => ({
      id: merchant.id,
      name: merchant.business_name,
      displayName: merchant.display_name,
      email: merchant.email,
      phone: merchant.phone,
      status: merchant.status,
      emoji: emojis[i % emojis.length],
      isOnline: merchant.is_online,
      rating: parseFloat(merchant.rating),
      ratingCount: parseInt(merchant.rating_count),
      trades: parseInt(merchant.total_trades),
      volume: parseFloat(merchant.total_volume),
      completedCount: parseInt(merchant.completed_count),
      cancelledCount: parseInt(merchant.cancelled_count),
      disputedCount: parseInt(merchant.disputed_count),
      avgResponseTimeMins: parseFloat(merchant.avg_response_time_mins),
      verificationLevel: parseInt(merchant.verification_level),
      autoAcceptEnabled: merchant.auto_accept_enabled,
      balance: parseFloat(merchant.balance),
      sinrBalance: parseFloat(merchant.sinr_balance),
      lastSeenAt: merchant.last_seen_at,
      createdAt: merchant.created_at,
      hasOpsAccess: merchant.has_ops_access,
      hasComplianceAccess: merchant.has_compliance_access,
    }));

    return NextResponse.json({
      success: true,
      data: formattedMerchants,
      total: parseInt(countResult?.count || '0'),
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching admin merchants:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch merchants' },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/merchants - Toggle merchant access flags
// Body: { merchantId: string, hasOpsAccess?: boolean, hasComplianceAccess?: boolean }
export async function PATCH(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { merchantId, hasOpsAccess, hasComplianceAccess } = body;

    if (!merchantId) {
      return NextResponse.json(
        { success: false, error: 'merchantId is required' },
        { status: 400 }
      );
    }

    // Build dynamic SET clause
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIdx = 0;

    if (typeof hasOpsAccess === 'boolean') {
      paramIdx++;
      setClauses.push(`has_ops_access = $${paramIdx}`);
      params.push(hasOpsAccess);
    }
    if (typeof hasComplianceAccess === 'boolean') {
      paramIdx++;
      setClauses.push(`has_compliance_access = $${paramIdx}`);
      params.push(hasComplianceAccess);
    }

    if (paramIdx === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one of hasOpsAccess or hasComplianceAccess is required' },
        { status: 400 }
      );
    }

    paramIdx++;
    params.push(merchantId);

    const updated = await queryOne<{ id: string; business_name: string; has_ops_access: boolean; has_compliance_access: boolean }>(
      `UPDATE merchants SET ${setClauses.join(', ')}
       WHERE id = $${paramIdx}
       RETURNING id, business_name, has_ops_access, COALESCE(has_compliance_access, false) as has_compliance_access`,
      params
    );

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Merchant not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        businessName: updated.business_name,
        hasOpsAccess: updated.has_ops_access,
        hasComplianceAccess: updated.has_compliance_access,
      },
    });
  } catch (error) {
    console.error('Error updating merchant access:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update merchant access' },
      { status: 500 }
    );
  }
}
