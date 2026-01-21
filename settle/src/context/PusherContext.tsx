'use client';

/**
 * Pusher Context Provider
 *
 * Manages the Pusher connection and provides channel subscription methods
 * With robust connection handling, retry logic, and proper cleanup
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';

// Types for pusher-js (defined locally to avoid import errors when module is missing)
interface Channel {
  bind: (event: string, callback: (data: unknown) => void) => void;
  unbind: (event: string, callback?: (data: unknown) => void) => void;
}

interface PresenceChannel extends Channel {
  members: {
    count: number;
    each: (callback: (member: { id: string; info: unknown }) => void) => void;
  };
}

interface PusherClientType {
  subscribe: (channelName: string) => Channel;
  unsubscribe: (channelName: string) => void;
  disconnect: () => void;
  connect: () => void;
  connection: {
    state: string;
    bind: (event: string, callback: (data: unknown) => void) => void;
    unbind: (event: string, callback?: (data: unknown) => void) => void;
  };
}

// Connection states
type ConnectionState = 'initialized' | 'connecting' | 'connected' | 'disconnected' | 'unavailable' | 'failed';

interface PusherContextType {
  // Connection state
  isConnected: boolean;
  connectionState: ConnectionState;

  // Actor info (for auth)
  actorType: 'user' | 'merchant' | 'compliance' | null;
  actorId: string | null;

  // Set actor for auth
  setActor: (type: 'user' | 'merchant' | 'compliance', id: string) => void;
  clearActor: () => void;

  // Subscribe to channels
  subscribe: (channelName: string) => Channel | null;
  unsubscribe: (channelName: string) => void;

  // Subscribe to presence channels
  subscribePresence: (channelName: string) => PresenceChannel | null;

  // Get channel if already subscribed
  getChannel: (channelName: string) => Channel | null;

  // Manual reconnect
  reconnect: () => void;
}

const PusherContext = createContext<PusherContextType | null>(null);

interface PusherProviderProps {
  children: ReactNode;
}

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export function PusherProvider({ children }: PusherProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('initialized');
  const [actorType, setActorType] = useState<'user' | 'merchant' | 'compliance' | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);

  const pusherRef = useRef<PusherClientType | null>(null);
  const channelsRef = useRef<Map<string, Channel>>(new Map());
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializingRef = useRef(false);
  const isMountedRef = useRef(true);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (pusherRef.current) {
      try {
        // Unsubscribe from all channels
        channelsRef.current.forEach((_, name) => {
          try {
            pusherRef.current?.unsubscribe(name);
          } catch {
            // Ignore unsubscribe errors during cleanup
          }
        });
        channelsRef.current.clear();

        // Disconnect
        pusherRef.current.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup
      }
      pusherRef.current = null;
    }

    isInitializingRef.current = false;
  }, []);

  // Initialize Pusher
  const initPusher = useCallback(async () => {
    // Prevent multiple simultaneous initializations
    if (isInitializingRef.current || !isMountedRef.current) {
      return;
    }

    if (!actorType || !actorId) {
      return;
    }

    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

    if (!key || !cluster) {
      console.warn('[Pusher] Credentials not configured - real-time features disabled');
      setConnectionState('unavailable');
      return;
    }

    isInitializingRef.current = true;

    try {
      const PusherClient = (await import('pusher-js')).default;

      // Don't proceed if unmounted during async import
      if (!isMountedRef.current) {
        isInitializingRef.current = false;
        return;
      }

      // Cleanup any existing connection
      if (pusherRef.current) {
        cleanup();
      }

      // Create Pusher client with auth headers
      const pusher = new PusherClient(key, {
        cluster,
        authEndpoint: '/api/pusher/auth',
        auth: {
          headers: {
            'x-actor-type': actorType,
            'x-actor-id': actorId,
          },
        },
        // Enable auto-reconnect with exponential backoff
        activityTimeout: 30000,
        pongTimeout: 10000,
      }) as unknown as PusherClientType;

      pusherRef.current = pusher;

      // State change handler
      const handleStateChange = (states: unknown) => {
        if (!isMountedRef.current) return;

        const s = states as { current: string; previous: string };
        const newState = s.current as ConnectionState;

        setConnectionState(newState);
        setIsConnected(newState === 'connected');

        if (process.env.NODE_ENV === 'development') {
          console.log('[Pusher] State:', s.previous, '->', s.current);
        }

        // Reset retry count on successful connection
        if (newState === 'connected') {
          retryCountRef.current = 0;
        }

        // Handle disconnection with retry
        if (newState === 'disconnected' || newState === 'failed') {
          if (retryCountRef.current < MAX_RETRIES && isMountedRef.current) {
            retryCountRef.current++;
            console.log(`[Pusher] Retrying connection (${retryCountRef.current}/${MAX_RETRIES})...`);

            retryTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current && pusherRef.current) {
                pusherRef.current.connect();
              }
            }, RETRY_DELAY_MS * retryCountRef.current);
          }
        }
      };

      // Error handler
      const handleError = (error: unknown) => {
        if (!isMountedRef.current) return;

        console.error('[Pusher] Error:', error);
        const e = error as { error?: { data?: { code?: number } } };

        if (e.error?.data?.code === 4004) {
          console.warn('[Pusher] Connection limit reached');
          setConnectionState('unavailable');
        }
      };

      // Bind event handlers
      pusher.connection.bind('state_change', handleStateChange);
      pusher.connection.bind('error', handleError);

      // Connect
      setConnectionState('connecting');
      pusher.connect();

      isInitializingRef.current = false;
    } catch (error) {
      console.warn('[Pusher] Module not available or initialization failed:', error);
      setConnectionState('unavailable');
      isInitializingRef.current = false;
    }
  }, [actorType, actorId, cleanup]);

  // Initialize Pusher when actor is set
  useEffect(() => {
    isMountedRef.current = true;

    if (actorType && actorId) {
      // Small delay to prevent race conditions with React strict mode
      const initTimeout = setTimeout(() => {
        initPusher();
      }, 100);

      return () => {
        clearTimeout(initTimeout);
      };
    }

    return undefined;
  }, [actorType, actorId, initPusher]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  // Set actor for authentication
  const setActor = useCallback((type: 'user' | 'merchant' | 'compliance', id: string) => {
    setActorType(type);
    setActorId(id);
  }, []);

  // Clear actor and disconnect
  const clearActor = useCallback(() => {
    cleanup();
    setActorType(null);
    setActorId(null);
    setIsConnected(false);
    setConnectionState('initialized');
  }, [cleanup]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    cleanup();
    if (actorType && actorId) {
      initPusher();
    }
  }, [actorType, actorId, cleanup, initPusher]);

  // Subscribe to a channel
  const subscribe = useCallback((channelName: string): Channel | null => {
    const pusher = pusherRef.current;
    if (!pusher) {
      // Silently return null - Pusher will initialize and hooks will retry
      return null;
    }

    // Check if already subscribed
    const existing = channelsRef.current.get(channelName);
    if (existing) {
      return existing;
    }

    try {
      // Subscribe
      const channel = pusher.subscribe(channelName);
      channelsRef.current.set(channelName, channel);

      channel.bind('pusher:subscription_error', (error: unknown) => {
        console.error(`[Pusher] Subscription error for ${channelName}:`, error);
      });

      channel.bind('pusher:subscription_succeeded', () => {
        // Subscription succeeded
      });

      return channel;
    } catch (error) {
      console.error(`[Pusher] Failed to subscribe to ${channelName}:`, error);
      return null;
    }
  }, []);

  // Unsubscribe from a channel
  const unsubscribe = useCallback((channelName: string) => {
    const pusher = pusherRef.current;
    if (!pusher) return;

    try {
      pusher.unsubscribe(channelName);
      channelsRef.current.delete(channelName);

    } catch (error) {
      console.error(`[Pusher] Failed to unsubscribe from ${channelName}:`, error);
    }
  }, []);

  // Subscribe to a presence channel
  const subscribePresence = useCallback((channelName: string): PresenceChannel | null => {
    const channel = subscribe(channelName);
    return channel as PresenceChannel | null;
  }, [subscribe]);

  // Get a channel if already subscribed
  const getChannel = useCallback((channelName: string): Channel | null => {
    return channelsRef.current.get(channelName) || null;
  }, []);

  const value: PusherContextType = {
    isConnected,
    connectionState,
    actorType,
    actorId,
    setActor,
    clearActor,
    subscribe,
    unsubscribe,
    subscribePresence,
    getChannel,
    reconnect,
  };

  return (
    <PusherContext.Provider value={value}>
      {children}
    </PusherContext.Provider>
  );
}

// Hook to use Pusher context
export function usePusher(): PusherContextType {
  const context = useContext(PusherContext);
  if (!context) {
    throw new Error('usePusher must be used within a PusherProvider');
  }
  return context;
}

// Hook to check if Pusher is available (optional usage)
export function usePusherOptional(): PusherContextType | null {
  return useContext(PusherContext);
}
