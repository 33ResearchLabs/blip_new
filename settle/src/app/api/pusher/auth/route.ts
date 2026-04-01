/**
 * Pusher Authentication Endpoint
 *
 * Authenticates private and presence channel subscriptions
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
} from '@/lib/middleware/auth';

// Get Pusher server instance
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

export async function POST(request: NextRequest) {
  try {
    const pusher = getPusherServer();
    if (!pusher) {
      return NextResponse.json(
        { error: 'Pusher not configured' },
        { status: 500 }
      );
    }

    // Parse the request body (URL encoded form data from pusher-js)
    const formData = await request.formData();
    const socketId = formData.get('socket_id') as string;
    const channelName = formData.get('channel_name') as string;

    if (!socketId || !channelName) {
      return NextResponse.json(
        { error: 'Missing socket_id or channel_name' },
        { status: 400 }
      );
    }

    // Get actor identity from headers (set by Pusher client)
    // DB verification happens per-channel in the switch block below
    const actorType = request.headers.get('x-actor-type') as 'user' | 'merchant' | 'compliance' | null;
    const actorId = request.headers.get('x-actor-id');

    if (!actorType || !actorId || !['user', 'merchant', 'compliance'].includes(actorType)) {
      return NextResponse.json(
        { error: 'Missing or invalid actor credentials' },
        { status: 401 }
      );
    }

    // Parse the channel name to determine authorization
    const { type: channelType, id: channelId } = parseChannelName(channelName);

    // Authorize based on channel type
    let authorized = false;

    switch (channelType) {
      case 'user':
        // User can only subscribe to their own channel
        if (actorType === 'user' && channelId === actorId) {
          authorized = await verifyUser(actorId);
        }
        break;

      case 'merchant':
        // Merchant can only subscribe to their own channel
        if (actorType === 'merchant' && channelId === actorId) {
          authorized = await verifyMerchant(actorId);
        }
        break;

      case 'merchants-global':
        // Any verified merchant can subscribe to the global merchants channel
        // This is used to broadcast new orders to all merchants
        if (actorType === 'merchant') {
          authorized = await verifyMerchant(actorId);
        }
        break;

      case 'order':
      case 'presence-order':
        // User, merchant, or compliance can subscribe if they have access
        if (channelId) {
          if (actorType === 'user') {
            authorized = await canUserAccessOrder(actorId, channelId);
          } else if (actorType === 'merchant') {
            authorized = await canMerchantAccessOrder(actorId, channelId);
          } else if (actorType === 'compliance') {
            authorized = await canComplianceAccessOrder(actorId, channelId);
          }
        }
        break;

      default:
        authorized = false;
    }

    if (!authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Generate auth response
    if (channelName.startsWith('presence-')) {
      // Presence channel — include actor type and display name
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
    } else {
      // Private channel
      const authResponse = pusher.authorizeChannel(socketId, channelName);
      return NextResponse.json(authResponse);
    }
  } catch (error) {
    console.error('Pusher auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}
