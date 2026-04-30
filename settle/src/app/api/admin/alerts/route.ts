/**
 * GET /api/admin/alerts
 *
 * Returns recent security alerts from the in-memory guard system.
 * Admin-only endpoint — requires Bearer token.
 *
 * Query params:
 *   severity=HIGH|MEDIUM (optional filter)
 *   limit=50 (default)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { getRecentAlerts } from '@/lib/guards';

export async function GET(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const searchParams = request.nextUrl.searchParams;
  const severity = searchParams.get('severity') || undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

  try {
    const alerts = await getRecentAlerts(limit, severity as 'HIGH' | 'MEDIUM' | undefined);

    return NextResponse.json({
      success: true,
      data: alerts,
      meta: { total: alerts.length, limit },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch alerts' },
      { status: 500 }
    );
  }
}
