// GET /api/waitlist/referrals
// Returns all referrals made by the current actor (newest first).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, forbiddenResponse } from '@/lib/middleware/auth';
import { getMyReferrals } from '@/lib/waitlist/referral';
import type { WaitlistActorType } from '@/lib/types/database';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Only users and merchants can view referrals');
  }
  const referrals = await getMyReferrals(auth.actorId, auth.actorType as WaitlistActorType);
  return NextResponse.json({ success: true, data: { referrals } });
}
