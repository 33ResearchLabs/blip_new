/**
 * Risk Profile API — Full Admin Visibility
 *
 * GET /api/risk-profile/:entityId?type=user|merchant
 *
 * Returns complete aggregated risk + activity profile.
 * If type is omitted, auto-detects by trying both tables.
 * Requires admin auth.
 *
 * Response includes: basic info, risk summary, behavioral stats,
 * financial stats, device intelligence, network intelligence,
 * risk events timeline, blacklist status, session insights, computed flags.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { getRiskProfile } from '@/lib/db/repositories/risk';
import { queryOne } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  // Admin-only endpoint
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const { entityId } = await params;
    let entityType = request.nextUrl.searchParams.get('type') as 'user' | 'merchant' | null;

    // Validate type if provided
    if (entityType && !['user', 'merchant'].includes(entityType)) {
      return NextResponse.json(
        { success: false, error: 'Invalid type. Must be "user" or "merchant".' },
        { status: 400 }
      );
    }

    // Auto-detect entity type if not provided
    if (!entityType) {
      const [userExists, merchantExists] = await Promise.all([
        queryOne<{ id: string }>('SELECT id FROM users WHERE id = $1', [entityId]).catch(() => null),
        queryOne<{ id: string }>('SELECT id FROM merchants WHERE id = $1', [entityId]).catch(() => null),
      ]);
      if (userExists) entityType = 'user';
      else if (merchantExists) entityType = 'merchant';
      else {
        return NextResponse.json(
          { success: false, error: 'Entity not found in users or merchants' },
          { status: 404 }
        );
      }
    }

    const profile = await getRiskProfile(entityId, entityType);

    if (!profile) {
      return NextResponse.json(
        { success: false, error: 'Entity not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    console.error('[API] GET /api/risk-profile error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch risk profile' },
      { status: 500 }
    );
  }
}
