'use client';

/**
 * Pusher Client
 *
 * Browser-side Pusher instance for subscribing to channels
 */

import PusherClient from 'pusher-js';

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

    pusherClient = new PusherClient(key, {
      cluster,
      authEndpoint: '/api/pusher/auth',
      authTransport: 'ajax',
      auth: {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    });

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
