import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface ActivityRow {
  id: string;
  type: string;
  message: string;
  status: string;
  created_at: string;
}

// GET /api/admin/activity - Get recent platform activity
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');

    // Combine multiple sources of activity into a unified feed
    const activities = await query<ActivityRow>(`
      (
        -- Completed trades
        SELECT
          o.id::text,
          'trade' as type,
          'Trade ' || o.order_number || ' completed' as message,
          'success' as status,
          COALESCE(o.completed_at, o.created_at) as created_at
        FROM orders o
        WHERE o.status = 'completed'
        ORDER BY o.completed_at DESC NULLS LAST
        LIMIT 10
      )
      UNION ALL
      (
        -- Orders entering escrow
        SELECT
          o.id::text,
          'escrow' as type,
          '$' || o.crypto_amount::int || ' locked in escrow' as message,
          'warning' as status,
          COALESCE(o.escrowed_at, o.created_at) as created_at
        FROM orders o
        WHERE o.status = 'escrowed'
        ORDER BY o.escrowed_at DESC NULLS LAST
        LIMIT 5
      )
      UNION ALL
      (
        -- New disputes
        SELECT
          d.id::text,
          'dispute' as type,
          'Dispute raised on order' as message,
          'error' as status,
          d.created_at as created_at
        FROM disputes d
        WHERE d.status = 'open'
        ORDER BY d.created_at DESC
        LIMIT 5
      )
      UNION ALL
      (
        -- Resolved disputes
        SELECT
          d.id::text,
          'dispute' as type,
          'Dispute resolved' as message,
          'success' as status,
          COALESCE(d.resolved_at, d.created_at) as created_at
        FROM disputes d
        WHERE d.status = 'resolved'
        ORDER BY d.resolved_at DESC NULLS LAST
        LIMIT 5
      )
      UNION ALL
      (
        -- New users
        SELECT
          u.id::text,
          'user' as type,
          'New user registered' as message,
          'info' as status,
          u.created_at as created_at
        FROM users u
        ORDER BY u.created_at DESC
        LIMIT 5
      )
      UNION ALL
      (
        -- Merchants going online
        SELECT
          m.id::text,
          'merchant' as type,
          m.business_name || ' came online' as message,
          'info' as status,
          m.updated_at as created_at
        FROM merchants m
        WHERE m.is_online = true
        ORDER BY m.updated_at DESC
        LIMIT 5
      )
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    // Format time ago
    const formatTimeAgo = (dateStr: string) => {
      const date = new Date(dateStr);
      const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

      if (seconds < 60) return 'just now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    };

    const formattedActivities = activities.map((activity, i) => ({
      id: `${activity.type}_${activity.id}_${i}`,
      type: activity.type,
      message: activity.message,
      status: activity.status,
      time: formatTimeAgo(activity.created_at),
      createdAt: activity.created_at,
    }));

    return NextResponse.json({ success: true, data: formattedActivities });
  } catch (error) {
    console.error('Error fetching admin activity:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch activity' },
      { status: 500 }
    );
  }
}
