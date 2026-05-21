// Waitlist access gate. Two layers of enforcement protect the live app from
// a waitlisted account touching any real-money endpoint:
//
//   Layer 1 (perimeter): middleware redirects /waitlist'd browsers to the
//                        waitlist dashboard.
//   Layer 2 (server):    requireActiveActor() — call this in any sensitive
//                        API route. Returns a 403 NextResponse if the
//                        authenticated actor is waitlisted.
//
// Existing rows default to waitlist_status='active', so the live app is
// unaffected. Only newly-created waitlist signups (status='waitlisted') are
// blocked.

import { NextRequest, NextResponse } from 'next/server';
import { requireTokenAuth, forbiddenResponse } from '@/lib/middleware/auth';
import { queryOne } from '@/lib/db';
import type { WaitlistStatus } from '@/lib/types/database';

// Tiny in-memory cache so hot endpoints don't hit Postgres per request just
// to read a status that almost never changes. Keyed by (actorType:actorId).
// Cleared on demand via clearWaitlistStatusCache(). 60s TTL is short enough
// that an admin "Activate" flip is reflected within a minute without the
// admin having to bust anything.
const STATUS_TTL_MS = 60_000;
const statusCache = new Map<string, { status: WaitlistStatus; at: number }>();

export async function getWaitlistStatus(
  actorType: 'user' | 'merchant',
  actorId: string,
): Promise<WaitlistStatus> {
  const key = `${actorType}:${actorId}`;
  const cached = statusCache.get(key);
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) {
    return cached.status;
  }
  const table = actorType === 'merchant' ? 'merchants' : 'users';
  const row = await queryOne<{ waitlist_status: WaitlistStatus | null }>(
    `SELECT waitlist_status FROM ${table} WHERE id = $1`,
    [actorId],
  );
  const status = (row?.waitlist_status ?? 'active') as WaitlistStatus;
  statusCache.set(key, { status, at: Date.now() });
  return status;
}

export function clearWaitlistStatusCache(actorType?: 'user' | 'merchant', actorId?: string): void {
  if (actorType && actorId) {
    statusCache.delete(`${actorType}:${actorId}`);
  } else {
    statusCache.clear();
  }
}

/**
 * Gate for sensitive routes. Wraps requireTokenAuth and additionally blocks
 * waitlisted accounts with 403. Compliance / admin / system actors pass
 * straight through (the gate only checks user + merchant rows).
 *
 * Usage:
 *   const auth = await requireActiveActor(request);
 *   if (auth instanceof NextResponse) return auth;
 */
export async function requireActiveActor(
  request: NextRequest,
): Promise<Awaited<ReturnType<typeof requireTokenAuth>>> {
  const auth = await requireTokenAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') return auth;

  const status = await getWaitlistStatus(auth.actorType, auth.actorId);
  if (status === 'waitlisted') {
    return forbiddenResponse(
      'Your account is on the waitlist. Full app access opens after activation.',
    );
  }
  if (status === 'rejected') {
    return forbiddenResponse('Your account has been rejected.');
  }
  return auth;
}
