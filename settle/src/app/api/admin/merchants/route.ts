import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

interface MerchantRow {
  id: string;
  business_name: string;
  is_online: boolean;
  rating: string;
  total_trades: string;
  total_volume: string;
  created_at: string;
  has_ops_access: boolean;
  has_compliance_access: boolean;
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
        m.created_at::text,
        m.has_ops_access,
        COALESCE(m.has_compliance_access, false) as has_compliance_access
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
      hasOpsAccess: merchant.has_ops_access,
      hasComplianceAccess: merchant.has_compliance_access,
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
