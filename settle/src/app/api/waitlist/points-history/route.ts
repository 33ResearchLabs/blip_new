// GET /api/waitlist/points-history?limit=50
//
// Audit-log entries for the current actor's blip points (newest first).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, forbiddenResponse } from '@/lib/middleware/auth';
import { getPointHistory } from '@/lib/waitlist/credit';
import type { WaitlistActorType } from '@/lib/types/database';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Only users and merchants can view points history');
  }

  const limitParam = request.nextUrl.searchParams.get('limit');
  const requested = limitParam ? parseInt(limitParam, 10) : 50;
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 200) : 50;

  const history = await getPointHistory(auth.actorId, auth.actorType as WaitlistActorType, limit);
  return NextResponse.json({ success: true, data: { history } });
}
