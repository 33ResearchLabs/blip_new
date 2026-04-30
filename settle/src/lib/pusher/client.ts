'use client';

/**
 * Pusher Client
 *
 * Browser-side Pusher instance for subscribing to channels
 */

import PusherClient from 'pusher-js';
import { buildPusherAuthHeaders } from './authHeaders';

// Singleton Pusher client instance
let pusherClient: PusherClient | null = null;

/**
 * Get or create the Pusher client instance
 */
export function getPusherClient(): PusherClient | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!pusherClient) {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

    if (!key || !cluster) {
      console.warn('Pusher client credentials not configured');
      return null;
    }

    // Custom authorizer: reads the Bearer token at every auth call so token
    // rotation is picked up. x-actor-id / x-actor-type are NOT sent — the
    // server derives identity from the verified token only.
    pusherClient = new PusherClient(key, {
      cluster,
      authEndpoint: '/api/pusher/auth',
      authTransport: 'ajax',
      authorizer: (channel: { name: string }) => ({
        authorize: (
          socketId: string,
          callback: (err: Error | null, data: unknown) => void,
        ) => {
          const body = new URLSearchParams({
            socket_id: socketId,
            channel_name: channel.name,
          }).toString();
          fetch('/api/pusher/auth', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              ...buildPusherAuthHeaders(),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
          })
            .then(async (res) => {
              if (!res.ok) {
                let errMsg = `Pusher auth failed: ${res.status}`;
                try {
                  const errBody = await res.json();
                  if (errBody?.error) errMsg = `${errMsg} — ${errBody.error}`;
                } catch { /* non-JSON body */ }
                callback(new Error(errMsg), null);
                return;
              }
              const data = await res.json();
              callback(null, data);
            })
            .catch((err) => callback(err instanceof Error ? err : new Error(String(err)), null));
        },
      }),
    } as unknown as ConstructorParameters<typeof PusherClient>[1]);

    // Log connection state changes in development
    if (process.env.NODE_ENV === 'development') {
      pusherClient.connection.bind('state_change', (states: { current: string; previous: string }) => {
        console.log('[Pusher] Connection state:', states.previous, '->', states.current);
      });

      pusherClient.connection.bind('error', (error: Error) => {
        console.error('[Pusher] Connection error:', error);
      });
    }
  }

  return pusherClient;
}

/**
 * Disconnect and cleanup the Pusher client
 */
export function disconnectPusher(): void {
  if (pusherClient) {
    pusherClient.disconnect();
    pusherClient = null;
  }
}

/**
 * Get the current connection state
 */
export function getConnectionState(): string {
  if (!pusherClient) return 'disconnected';
  return pusherClient.connection.state;
}

/**
 * Check if connected
 */
export function isConnected(): boolean {
  return getConnectionState() === 'connected';
}
