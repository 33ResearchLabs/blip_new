/**
 * POST /api/ws/ticket
 *
 * Issues a single-use, short-lived (default: 45s) connection ticket for the
 * native WebSocket server at /ws/chat. The browser cannot set Authorization
 * headers on `new WebSocket(...)`, and putting long-lived auth tokens in the
 * URL or subprotocol field is unsafe (proxies/log aggregators capture both).
 *
 * Flow:
 *   1. Client calls POST /api/ws/ticket with `credentials: 'include'`.
 *   2. We authenticate via the existing httpOnly access cookie (requireAuth).
 *   3. We mint an opaque ticket bound to (actorId, actorType) and store it
 *      in Redis (or an in-memory fallback) with a 45-second TTL.
 *   4. Client opens `new WebSocket(url, ['bearer', ticket])`.
 *   5. WS server atomically consumes the ticket on upgrade; replay impossible.
 *
 * No auth tokens ever leave the cookie jar. No tokens in localStorage.
 * No tokens in the URL.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, successResponse } from '@/lib/middleware/auth';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
// CommonJS module — shared with websocket-server.js (plain Node) so a
// single ticket store is the source of truth for both call sites.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createTicket, TTL_SECONDS } = require('@/lib/auth/wsTicketStore') as {
  createTicket: (p: { actorId: string; actorType: 'user' | 'merchant' | 'compliance' }) => Promise<{ ticket: string; expiresInSeconds: number }>;
  TTL_SECONDS: number;
};

export async function POST(request: NextRequest) {
  // Rate limit hard. A ticket is a one-shot bearer credential; bursting
  // this endpoint should not be a path to enumerate or grind anything.
  const rl = await checkRateLimit(request, 'ws:ticket', AUTH_LIMIT);
  if (rl) return rl;

  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Defence in depth: the WS server only knows three actor types; refuse
    // to mint tickets for anything else even if the auth context drifts.
    if (!['user', 'merchant', 'compliance'].includes(auth.actorType)) {
      return errorResponse('Unsupported actor type', 403);
    }

    const { ticket, expiresInSeconds } = await createTicket({
      actorId: auth.actorId,
      actorType: auth.actorType as 'user' | 'merchant' | 'compliance',
    });

    return successResponse({
      ticket,
      // Surface the TTL so clients can decide whether to refresh before
      // opening a delayed connection. Defaults to 45s, env-tunable.
      expiresIn: expiresInSeconds,
      // Tiny hint so clients don't have to remember the canonical TTL.
      protocols: ['bearer', '<ticket>'],
    });
  } catch (err) {
    console.error('[POST /api/ws/ticket] error:', err);
    return errorResponse('Failed to issue WebSocket ticket');
  }
}

// Bind the constant into the bundle so tree-shaking can't drop the import.
// (Belt-and-braces — `require()` already does this, but keeps the module
// graph explicit for any future bundler changes.)
export const _wsTicketTtl = TTL_SECONDS;
