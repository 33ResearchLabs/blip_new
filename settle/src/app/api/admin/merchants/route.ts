import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

interface MerchantRow {
  id: string;
  business_name: string;
  is_online: boolean;
  rating: string;
  total_trades: string;
  total_volume: string;
  created_at: string;
}

// GET /api/admin/merchants - Get all merchants with stats
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const sortBy = searchParams.get('sort') || 'volume'; // volume, trades, rating

    let orderClause = 'ORDER BY total_volume DESC';
    if (sortBy === 'trades') {
      orderClause = 'ORDER BY total_trades DESC';
    } else if (sortBy === 'rating') {
      orderClause = 'ORDER BY m.rating DESC NULLS LAST';
    }

    const merchants = await query<MerchantRow>(`
      SELECT
        m.id,
        m.business_name,
        m.is_online,
        COALESCE(m.rating, 0)::text as rating,
        COALESCE(m.total_trades, 0)::text as total_trades,
        COALESCE(
          (SELECT SUM(crypto_amount) FROM orders WHERE merchant_id = m.id AND status = 'completed'),
          0
        )::text as total_volume,
        m.created_at::text
      FROM merchants m
      ${orderClause}
      LIMIT $1
    `, [limit]);

    // Transform to frontend format with emojis
    const emojis = ['🏪', '💎', '👑', '🛡️', '⚡', '🌟', '💰', '🔥', '🦊', '🐋'];
    const formattedMerchants = merchants.map((merchant, i) => ({
      id: merchant.id,
      name: merchant.business_name,
      emoji: emojis[i % emojis.length],
      isOnline: merchant.is_online,
      rating: parseFloat(merchant.rating),
      trades: parseInt(merchant.total_trades),
      volume: parseFloat(merchant.total_volume),
      createdAt: merchant.created_at,
    }));

    return NextResponse.json({ success: true, data: formattedMerchants });
  } catch (error) {
    console.error('Error fetching admin merchants:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch merchants' },
      { status: 500 }
    );
  }
}
