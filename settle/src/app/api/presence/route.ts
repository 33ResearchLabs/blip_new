import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { getGlobalPresence } from '@/lib/chat/presence';

// GET /api/presence?actorType=user|merchant&actorId=<uuid>
// Reads from Redis first (fast), falls back to DB if Redis is unavailable.
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof (await import('next/server')).NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const actorType = searchParams.get('actorType');
    const actorId = searchParams.get('actorId');

    if (!actorType || !['user', 'merchant', 'compliance'].includes(actorType)) {
      return validationErrorResponse(['Invalid actorType']);
    }
    if (!actorId) {
      return validationErrorResponse(['Missing actorId']);
    }

    // Primary: Redis (fast, TTL-based — no stale data)
    const redisPresence = await getGlobalPresence(actorType, actorId);
    if (redisPresence.isOnline || redisPresence.lastSeen) {
      return successResponse({
        actorType, actorId,
        isOnline: redisPresence.isOnline,
        lastSeen: redisPresence.lastSeen,
      });
    }

    // Fallback: DB (for when Redis is down or actor has never used Redis path)
    let isOnline = false;
    let lastSeen: string | null = null;
    try {
      const rows = await query<{ is_online: boolean; last_seen: Date | null }>(
        `SELECT is_online, last_seen
         FROM chat_presence
         WHERE actor_type = $1 AND actor_id = $2
         ORDER BY last_seen DESC NULLS LAST
         LIMIT 1`,
        [actorType, actorId]
      );
      if (rows.length > 0) {
        lastSeen = rows[0].last_seen?.toISOString() || null;
        const fresh = lastSeen ? (Date.now() - new Date(lastSeen).getTime()) < 90_000 : false;
        isOnline = !!rows[0].is_online && fresh;
      }
    } catch {
      // Table may not exist yet — return offline
    }

    return successResponse({ actorType, actorId, isOnline, lastSeen });
  } catch (error) {
    console.error('Presence lookup error:', error);
    return errorResponse('Internal server error');
  }
}
