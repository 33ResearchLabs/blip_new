// GET /api/waitlist/leaderboard?limit=10
//
// Top N waitlist accounts by blip_points, across both users and merchants.
// Public — anyone can see who's on top.

import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboard } from '@/lib/waitlist/leaderboard';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';

export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(request, 'waitlist:leaderboard', STANDARD_LIMIT);
  if (rl) return rl;

  const limitParam = request.nextUrl.searchParams.get('limit');
  const requested = limitParam ? parseInt(limitParam, 10) : 10;
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 10;

  const rows = await getLeaderboard(limit);
  return NextResponse.json({ success: true, data: { leaderboard: rows } });
}
