/**
 * Pusher Authentication Endpoint
 *
 * Authenticates private and presence channel subscriptions.
 *
 * Identity is derived ONLY from the verified session token via requireAuth().
 * Client-supplied identity headers (x-actor-id, x-actor-type) are NOT trusted
 * and are not read here — historically they enabled a channel-auth bypass.
 *
 * The route is listed in middleware.ts PUBLIC_EXACT, so this handler owns
 * the entire auth check.
 */

import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';
import { parseChannelName } from '@/lib/pusher/channels';
import {
  canUserAccessOrder,
  canMerchantAccessOrder,
  canComplianceAccessOrder,
  verifyUser,
  verifyMerchant,
  requireAuth,
} from '@/lib/middleware/auth';

function getPusherServer(): Pusher | null {
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    return null;
  }

  return new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });
}

// Fire-and-forget structured log for rejected channel auth attempts.
// Surfaces in admin error-logs dashboard so spikes are detectable.
function logUnauthorizedAttempt(reason: string, ctx: Record<string, unknown>): void {
  // Always emit a console line — kept terse for production log volume
  console.warn('[Pusher Auth] rejected', { reason, ...ctx });

  void (async () => {
    try {
      const { safeLog } = await import('@/lib/errorTracking/logger');
      safeLog({
        type: 'pusher.auth_rejected',
        severity: 'WARN',
        message: `Pusher channel auth rejected: ${reason}`,
        source: 'backend',
        metadata: ctx,
      });
    } catch { /* swallow — logging must never cascade */ }
  })();
}

export async function POST(request: NextRequest) {
  try {
    const pusher = getPusherServer();
    if (!pusher) {
      return NextResponse.json(
        { error: 'Pusher not configured' },
        { status: 500 }
      );
    }

    // Pusher-js sends form-encoded { socket_id, channel_name }
    const formData = await request.formData();
    const socketId = formData.get('socket_id') as string;
    const channelName = formData.get('channel_name') as string;

    if (!socketId || !channelName) {
      return NextResponse.json(
        { error: 'Missing socket_id or channel_name' },
        { status: 400 }
      );
    }

    // ── Verified identity (token only — no header trust) ─────────────
    // requireAuth handles: token verify, session-revocation check,
    // blacklist, and dev-mode header fallback (x-user-id / x-merchant-id /
    // x-compliance-id). It does NOT honor x-actor-id / x-actor-type.
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) {
      logUnauthorizedAttempt('no valid session', {
        channelName,
        socketId: socketId.slice(0, 16),
        ip: request.headers.get('x-forwarded-for') ?? null,
      });
      return auth;
    }

    // 'system' actors are internal-only — must never authorize a Pusher
    // subscription. Defensive: requireAuth would currently never produce
    // 'system' from a client request, but guard explicitly.
    if (
      auth.actorType !== 'user' &&
      auth.actorType !== 'merchant' &&
      auth.actorType !== 'compliance'
    ) {
      logUnauthorizedAttempt('unsupported actor type', {
        channelName,
        actorType: auth.actorType,
        actorId: auth.actorId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const actorType = auth.actorType;
    const actorId = auth.actorId;

    // Parse channel to determine authorization rule
    const { type: channelType, id: channelId } = parseChannelName(channelName);

    let authorized = false;
    let denyReason = 'channel rule mismatch';

    switch (channelType) {
      case 'user':
        if (actorType === 'user' && channelId === actorId) {
          authorized = await verifyUser(actorId);
          if (!authorized) denyReason = 'user no longer exists';
        } else {
          denyReason = 'cross-actor user channel subscription';
        }
        break;

      case 'merchant':
        if (actorType === 'merchant' && channelId === actorId) {
          authorized = await verifyMerchant(actorId);
          if (!authorized) denyReason = 'merchant inactive or missing';
        } else {
          denyReason = 'cross-actor merchant channel subscription';
        }
        break;

      case 'merchant-chat':
        if (actorType === 'merchant' && channelId === actorId) {
          authorized = await verifyMerchant(actorId);
          if (!authorized) denyReason = 'merchant inactive or missing';
        } else {
          denyReason = 'cross-actor merchant-chat subscription';
        }
        break;

      case 'merchants-global':
        // Any verified merchant — used to broadcast new orders
        if (actorType === 'merchant') {
          authorized = await verifyMerchant(actorId);
          if (!authorized) denyReason = 'merchant inactive or missing';
        } else {
          denyReason = 'non-merchant on merchants-global';
        }
        break;

      case 'order':
      case 'presence-order':
        if (channelId) {
          if (actorType === 'user') {
            authorized = await canUserAccessOrder(actorId, channelId);
          } else if (actorType === 'merchant') {
            authorized = await canMerchantAccessOrder(actorId, channelId);
          } else if (actorType === 'compliance') {
            authorized = await canComplianceAccessOrder(actorId, channelId);
          }
          if (!authorized) denyReason = 'order access denied';
        } else {
          denyReason = 'invalid order channel id';
        }
        break;

      default:
        denyReason = 'unknown channel type';
        authorized = false;
    }

    if (!authorized) {
      logUnauthorizedAttempt(denyReason, {
        channelName,
        channelType,
        channelId,
        actorType,
        actorId,
      });
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Generate auth response
    if (channelName.startsWith('presence-')) {
      let displayName: string = actorType;
      try {
        if (actorType === 'user') {
          const { getUserById } = await import('@/lib/db/repositories/users');
          const user = await getUserById(actorId);
          if (user?.username) displayName = user.username;
        } else if (actorType === 'merchant') {
          const { getMerchantById } = await import('@/lib/db/repositories/merchants');
          const merchant = await getMerchantById(actorId);
          if (merchant?.business_name) displayName = merchant.business_name;
        } else if (actorType === 'compliance') {
          displayName = 'Compliance Officer';
        }
      } catch {
        // Name lookup is best-effort — fall back to actorType
      }
      const presenceData = {
        user_id: actorId,
        user_info: {
          type: actorType,
          name: displayName,
        },
      };
      const authResponse = pusher.authorizeChannel(socketId, channelName, presenceData);
      return NextResponse.json(authResponse);
    }

    const authResponse = pusher.authorizeChannel(socketId, channelName);
    return NextResponse.json(authResponse);
  } catch (error) {
    console.error('Pusher auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}
