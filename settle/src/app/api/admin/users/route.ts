import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

interface UserRow {
  id: string;
  username: string;
  name: string;
  email: string;
  wallet_address: string | null;
  phone: string | null;
  kyc_status: string;
  kyc_level: string;
  total_trades: string;
  total_volume: string;
  rating: string;
  rating_count: string;
  balance: string;
  sinr_balance: string;
  completed_count: string;
  cancelled_count: string;
  disputes_total: string;
  disputes_raised_by_user: string;
  disputes_against_user: string;
  reputation_score: string;
  created_at: string;
  updated_at: string;
}

const SORT_COLUMNS: Record<string, string> = {
  volume: 'total_volume DESC',
  trades: 'u.total_trades DESC',
  rating: 'u.rating DESC NULLS LAST',
  completed: 'completed_count DESC',
  cancelled: 'cancelled_count DESC',
  disputes_total: 'disputes_total DESC',
  balance: 'u.balance DESC',
  reputation: 'u.reputation_score DESC NULLS LAST',
  newest: 'u.created_at DESC',
  oldest: 'u.created_at ASC',
  name: 'u.username ASC',
};

// GET /api/admin/users - Get all users with stats
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const sortBy = searchParams.get('sort') || 'volume';
    const kycFilter = searchParams.get('kyc'); // none, pending, verified, rejected
    const searchQuery = searchParams.get('search');
    const lastActiveFilter = searchParams.get('last_active');
    const volumeTierFilter = searchParams.get('volume_tier');
    const riskFilter = searchParams.get('risk');
    const ratingFilter = searchParams.get('rating');

    const orderClause = `ORDER BY ${SORT_COLUMNS[sortBy] || SORT_COLUMNS.volume}`;

    // Exclude placeholder/ghost users from the admin Users view. These rows are
    // synthetic accounts created for unclaimed broadcast (open_order_*) and
    // M2M (m2m_*) orders — they're not real signed-up users.
    const conditions: string[] = [
      "u.username IS NOT NULL",
      "u.username NOT LIKE 'open_order_%'",
      "u.username NOT LIKE 'm2m_%'",
    ];
    const params: unknown[] = [];
    let paramIdx = 0;

    if (kycFilter) {
      paramIdx++;
      conditions.push(`u.kyc_status = $${paramIdx}::kyc_status`);
      params.push(kycFilter);
    }
    if (searchQuery) {
      paramIdx++;
      conditions.push(`(u.username ILIKE $${paramIdx} OR u.name ILIKE $${paramIdx} OR u.email ILIKE $${paramIdx} OR u.id::text ILIKE $${paramIdx} OR u.wallet_address ILIKE $${paramIdx})`);
      params.push(`%${searchQuery}%`);
    }

    // Last active
    if (lastActiveFilter === 'never') {
      conditions.push('u.updated_at IS NULL');
    } else if (lastActiveFilter === '1d') {
      conditions.push("u.updated_at >= NOW() - INTERVAL '1 day'");
    } else if (lastActiveFilter === '7d') {
      conditions.push("u.updated_at >= NOW() - INTERVAL '7 days'");
    } else if (lastActiveFilter === '30d') {
      conditions.push("u.updated_at >= NOW() - INTERVAL '30 days'");
    } else if (lastActiveFilter === 'inactive') {
      conditions.push("(u.updated_at IS NULL OR u.updated_at < NOW() - INTERVAL '30 days')");
    }

    // Volume tier
    if (volumeTierFilter === '0') {
      conditions.push('COALESCE(u.total_volume, 0) = 0');
    } else if (volumeTierFilter === '1k') {
      conditions.push('COALESCE(u.total_volume, 0) > 0 AND COALESCE(u.total_volume, 0) < 1000');
    } else if (volumeTierFilter === '10k') {
      conditions.push('COALESCE(u.total_volume, 0) >= 1000 AND COALESCE(u.total_volume, 0) < 10000');
    } else if (volumeTierFilter === '100k') {
      conditions.push('COALESCE(u.total_volume, 0) >= 10000');
    }

    // Risk
    if (riskFilter === 'high_dispute') {
      conditions.push("COALESCE(u.total_trades, 0) > 0 AND (SELECT COUNT(*) FROM orders WHERE user_id = u.id AND disputed_at IS NOT NULL)::float / GREATEST(u.total_trades, 1) > 0.1");
    } else if (riskFilter === 'high_cancel') {
      conditions.push("COALESCE(u.total_trades, 0) > 0 AND (SELECT COUNT(*) FROM orders WHERE user_id = u.id AND status = 'cancelled')::float / GREATEST(u.total_trades, 1) > 0.2");
    } else if (riskFilter === 'zero_trades') {
      conditions.push('COALESCE(u.total_trades, 0) = 0');
    }

    // Rating
    if (ratingFilter === 'top') {
      conditions.push('u.rating >= 4.5');
    } else if (ratingFilter === 'high') {
      conditions.push('u.rating >= 4.0 AND u.rating < 4.5');
    } else if (ratingFilter === 'mid') {
      conditions.push('u.rating >= 3.0 AND u.rating < 4.0');
    } else if (ratingFilter === 'low') {
      conditions.push('COALESCE(u.rating, 0) > 0 AND u.rating < 3.0');
    } else if (ratingFilter === 'unrated') {
      conditions.push('(u.rating IS NULL OR u.rating = 0)');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    paramIdx++;
    const limitParam = paramIdx;
    params.push(limit);
    paramIdx++;
    const offsetParam = paramIdx;
    params.push(offset);

    const users = await query<UserRow>(`
      SELECT
        u.id,
        COALESCE(u.username, '') as username,
        CASE
          WHEN u.name IS NOT NULL AND u.name != 'Open Order' THEN u.name
          WHEN u.username IS NOT NULL AND u.username NOT LIKE 'open_order_%' THEN u.username
          ELSE ''
        END as name,
        COALESCE(u.email, '') as email,
        u.wallet_address,
        u.phone,
        u.kyc_status::text,
        COALESCE(u.kyc_level, 0)::text as kyc_level,
        COALESCE(u.total_trades, 0)::text as total_trades,
        COALESCE(u.total_volume, 0)::text as total_volume,
        COALESCE(u.rating, 0)::text as rating,
        COALESCE(u.rating_count, 0)::text as rating_count,
        COALESCE(u.balance, 0)::text as balance,
        COALESCE(u.sinr_balance, 0)::text as sinr_balance,
        COALESCE(
          (SELECT COUNT(*) FROM orders WHERE user_id = u.id AND status = 'completed'),
          0
        )::text as completed_count,
        COALESCE(
          (SELECT COUNT(*) FROM orders WHERE user_id = u.id AND status = 'cancelled'),
          0
        )::text as cancelled_count,
        COALESCE(
          (SELECT COUNT(*) FROM orders WHERE user_id = u.id AND disputed_at IS NOT NULL),
          0
        )::text as disputes_total,
        COALESCE(
          (SELECT COUNT(*) FROM orders WHERE user_id = u.id AND disputed_at IS NOT NULL AND disputed_by = 'user'),
          0
        )::text as disputes_raised_by_user,
        COALESCE(
          (SELECT COUNT(*) FROM orders WHERE user_id = u.id AND disputed_at IS NOT NULL AND (disputed_by = 'merchant' OR disputed_by IS NULL)),
          0
        )::text as disputes_against_user,
        COALESCE(u.reputation_score, 0)::text as reputation_score,
        u.created_at::text,
        u.updated_at::text
      FROM users u
      ${whereClause}
      ${orderClause}
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, params);

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM users u ${whereClause}`,
      params.slice(0, params.length - 2)
    );

    // Aggregate platform stats — also excludes placeholder/ghost users so the
    // KPI cards show real-user counts only.
    const summary = await queryOne<{
      total_users: string;
      active_users: string;
      verified_users: string;
      total_volume: string;
      total_trades: string;
      total_users_prev: string;
      total_volume_prev: string;
      total_trades_prev: string;
    }>(`
      SELECT
        COUNT(*)::text as total_users,
        COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '30 days')::text as active_users,
        COUNT(*) FILTER (WHERE kyc_status = 'verified')::text as verified_users,
        COALESCE(SUM(total_volume), 0)::text as total_volume,
        COALESCE(SUM(total_trades), 0)::text as total_trades,
        COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '30 days')::text as total_users_prev,
        COALESCE(SUM(total_volume) FILTER (WHERE created_at < NOW() - INTERVAL '30 days'), 0)::text as total_volume_prev,
        COALESCE(SUM(total_trades) FILTER (WHERE created_at < NOW() - INTERVAL '30 days'), 0)::text as total_trades_prev
      FROM users
      WHERE username IS NOT NULL
        AND username NOT LIKE 'open_order_%'
        AND username NOT LIKE 'm2m_%'
    `);

    const calcDelta = (current: number, prev: number) =>
      prev > 0 ? ((current - prev) / prev) * 100 : 0;

    const totalUsers = parseInt(summary?.total_users || '0');
    const activeUsers = parseInt(summary?.active_users || '0');
    const verifiedUsers = parseInt(summary?.verified_users || '0');
    const totalVolume = parseFloat(summary?.total_volume || '0');
    const totalTrades = parseInt(summary?.total_trades || '0');
    const totalUsersPrev = parseInt(summary?.total_users_prev || '0');
    const totalVolumePrev = parseFloat(summary?.total_volume_prev || '0');
    const totalTradesPrev = parseInt(summary?.total_trades_prev || '0');

    const formattedUsers = users.map((user) => ({
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      isPlaceholder: user.username.startsWith('open_order_') || user.wallet_address?.startsWith('placeholder_') || false,
      walletAddress: user.wallet_address,
      phone: user.phone,
      kycStatus: user.kyc_status,
      kycLevel: parseInt(user.kyc_level),
      totalTrades: parseInt(user.total_trades),
      volume: parseFloat(user.total_volume),
      rating: parseFloat(user.rating),
      ratingCount: parseInt(user.rating_count),
      balance: parseFloat(user.balance),
      sinrBalance: parseFloat(user.sinr_balance),
      completedCount: parseInt(user.completed_count),
      cancelledCount: parseInt(user.cancelled_count),
      disputesTotal: parseInt(user.disputes_total),
      disputesRaisedByUser: parseInt(user.disputes_raised_by_user),
      disputesAgainstUser: parseInt(user.disputes_against_user),
      reputationScore: parseInt(user.reputation_score),
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    }));

    return NextResponse.json({
      success: true,
      data: formattedUsers,
      total: parseInt(countResult?.count || '0'),
      limit,
      offset,
      summary: {
        totalUsers,
        activeUsers,
        verifiedUsers,
        totalVolume,
        totalTrades,
        totalUsersDelta: calcDelta(totalUsers, totalUsersPrev),
        totalVolumeDelta: calcDelta(totalVolume, totalVolumePrev),
        totalTradesDelta: calcDelta(totalTrades, totalTradesPrev),
      },
    });
  } catch (error) {
    console.error('Error fetching admin users:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
