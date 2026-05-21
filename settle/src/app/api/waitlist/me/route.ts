// GET /api/waitlist/me
//
// Returns the full waitlist context for the currently-authenticated actor:
//   - waitlist status, points, referral code on this actor's primary row
//   - whether they also exist as the OTHER actor type (link by email or wallet)
//   - task list (one row per quest)
//   - recent point-log entries
//   - referrals they've made
//
// This is the data the dashboard renders on load. One endpoint, one round trip.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, forbiddenResponse } from '@/lib/middleware/auth';
import { queryOne } from '@/lib/db';
import { getPointHistory } from '@/lib/waitlist/credit';
import { listTasksForActor } from '@/lib/db/repositories/waitlistTasks';
import { getMyReferrals } from '@/lib/waitlist/referral';
import type { WaitlistActorType, WaitlistStatus } from '@/lib/types/database';

interface PrimaryRow {
  id: string;
  email: string | null;
  wallet_address: string | null;
  display_name: string | null;
  username: string | null;
  waitlist_status: WaitlistStatus;
  waitlist_joined_at: string | null;
  waitlist_source: string | null;
  blip_points: number | null;
  referral_code: string | null;
}

interface CounterpartRow {
  id: string;
  waitlist_status: WaitlistStatus;
  blip_points: number | null;
  referral_code: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Only users and merchants can access the waitlist');
  }

  const actorType = auth.actorType as WaitlistActorType;
  const actorId = auth.actorId;

  const primaryTable = actorType === 'merchant' ? 'merchants' : 'users';
  const counterTable = actorType === 'merchant' ? 'users' : 'merchants';
  const primaryDisplayCol = actorType === 'merchant' ? 'display_name' : 'name';

  const primary = await queryOne<PrimaryRow>(
    `SELECT id, email, wallet_address, ${primaryDisplayCol} AS display_name, username,
            waitlist_status, waitlist_joined_at, waitlist_source,
            blip_points, referral_code
       FROM ${primaryTable}
      WHERE id = $1`,
    [actorId],
  );
  if (!primary) {
    return NextResponse.json({ success: false, error: 'Account not found' }, { status: 404 });
  }

  // Counterpart: find the OTHER actor type for the same person, linked by
  // email first, then wallet. Returns null if they haven't joined that side.
  let counterpart: CounterpartRow | null = null;
  if (primary.email) {
    counterpart = await queryOne<CounterpartRow>(
      `SELECT id, waitlist_status, blip_points, referral_code
         FROM ${counterTable}
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
      [primary.email],
    );
  }
  if (!counterpart && primary.wallet_address) {
    counterpart = await queryOne<CounterpartRow>(
      `SELECT id, waitlist_status, blip_points, referral_code
         FROM ${counterTable}
        WHERE wallet_address = $1
        LIMIT 1`,
      [primary.wallet_address],
    );
  }

  const [tasks, pointsHistory, referrals] = await Promise.all([
    listTasksForActor(actorId, actorType),
    getPointHistory(actorId, actorType, 25),
    getMyReferrals(actorId, actorType),
  ]);

  // Position in the waitlist line. Computed by counting how many waitlisted
  // accounts of the SAME type joined before us — cheap because the
  // waitlist_status partial index handles the filter.
  let position: number | null = null;
  if (primary.waitlist_status === 'waitlisted' && primary.waitlist_joined_at) {
    const posRow = await queryOne<{ ahead: string }>(
      `SELECT COUNT(*)::text AS ahead
         FROM ${primaryTable}
        WHERE waitlist_status = 'waitlisted'
          AND waitlist_joined_at IS NOT NULL
          AND waitlist_joined_at < $1`,
      [primary.waitlist_joined_at],
    );
    position = posRow ? parseInt(posRow.ahead, 10) + 1 : null;
  }

  return NextResponse.json({
    success: true,
    data: {
      actor: {
        id: primary.id,
        type: actorType,
        display_name: primary.display_name,
        username: primary.username,
        email: primary.email,
        waitlist_status: primary.waitlist_status,
        waitlist_joined_at: primary.waitlist_joined_at,
        waitlist_source: primary.waitlist_source,
        blip_points: primary.blip_points ?? 0,
        referral_code: primary.referral_code,
        position_in_line: position,
      },
      counterpart: counterpart
        ? {
            id: counterpart.id,
            type: actorType === 'merchant' ? 'user' : 'merchant',
            waitlist_status: counterpart.waitlist_status,
            blip_points: counterpart.blip_points ?? 0,
            referral_code: counterpart.referral_code,
          }
        : null,
      tasks,
      points_history: pointsHistory,
      referrals,
    },
  });
}
