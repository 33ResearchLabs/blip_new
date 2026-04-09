import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';

// POST /api/presence/heartbeat
// Upserts the current authenticated actor's presence row.
// Body: { isOnline?: boolean }  — defaults to true. Pass false on tab close to mark offline.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof (await import('next/server')).NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const isOnline = body?.isOnline !== false;

    const actorType = auth.actorType;
    const actorId = auth.actorId;
    if (!actorType || !actorId) return errorResponse('Missing actor');

    try {
      await query(
        `INSERT INTO chat_presence (actor_type, actor_id, is_online, last_seen, connection_id)
         VALUES ($1, $2, $3, NOW(), $4)
         ON CONFLICT (actor_type, actor_id)
         DO UPDATE SET is_online = EXCLUDED.is_online, last_seen = NOW()`,
        [actorType, actorId, isOnline, `hb-${Date.now()}`]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[presence/heartbeat] write failed:', msg);
      return errorResponse(`Presence write failed: ${msg}`);
    }

    return successResponse({ ok: true, actorType, actorId, isOnline });
  } catch (error) {
    console.error('Presence heartbeat error:', error);
    return errorResponse('Internal server error');
  }
}
