/**
 * POST   /api/user/push/subscribe  — register a Web Push subscription
 * DELETE /api/user/push/subscribe?endpoint=... — remove (e.g. on logout)
 *
 * Body for POST:
 *   { endpoint, keys: { p256dh, auth } }
 *
 * Idempotent on (actor, endpoint) — re-subscribing the same browser bumps
 * last_seen_at and resets failure_count instead of duplicating rows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
  validationErrorResponse,
} from '@/lib/middleware/auth';

export const dynamic = 'force-dynamic';

interface SubscriptionBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Push subscriptions are for users and merchants');
  }

  let body: SubscriptionBody;
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse(['Invalid JSON body']);
  }

  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const authKey = body.keys?.auth?.trim();
  if (!endpoint || !p256dh || !authKey) {
    return validationErrorResponse(['endpoint and keys (p256dh, auth) are required']);
  }
  if (endpoint.length > 2048 || p256dh.length > 256 || authKey.length > 64) {
    return validationErrorResponse(['Payload too large']);
  }

  const ua = request.headers.get('user-agent')?.slice(0, 500) || null;

  try {
    await query(
      `INSERT INTO push_subscriptions (actor_type, actor_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (endpoint) DO UPDATE
         SET actor_type    = EXCLUDED.actor_type,
             actor_id      = EXCLUDED.actor_id,
             p256dh        = EXCLUDED.p256dh,
             auth          = EXCLUDED.auth,
             user_agent    = EXCLUDED.user_agent,
             last_seen_at  = NOW(),
             failure_count = 0`,
      [auth.actorType, auth.actorId, endpoint, p256dh, authKey, ua],
    );
    return successResponse({ ok: true });
  } catch (e) {
    console.error('[API] POST /api/user/push/subscribe error:', e);
    return errorResponse('Failed to save subscription');
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const endpoint = request.nextUrl.searchParams.get('endpoint');
  if (!endpoint) return validationErrorResponse(['endpoint query param required']);

  const result = await query<{ id: string }>(
    `DELETE FROM push_subscriptions
      WHERE actor_id = $1 AND actor_type = $2 AND endpoint = $3
      RETURNING id`,
    [auth.actorId, auth.actorType, endpoint],
  );
  return successResponse({ deleted: result.length });
}
