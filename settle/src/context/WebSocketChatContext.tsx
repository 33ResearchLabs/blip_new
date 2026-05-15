'use client';

/**
 * WebSocket Chat Context Provider
 *
 * Manages the WebSocket connection for real-time chat messaging
 * Provides subscription methods and message handling
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
import type {
  ActorType,
  MessageType,
  ServerMessage,
  WSNewMessageEvent,
  WSTypingEvent,
  WSMessagesReadEvent,
  WSOrderEvent,
} from '@/lib/websocket/types';

// Connection states
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

// Callback types
type MessageCallback = (event: WSNewMessageEvent) => void;
type TypingCallback = (event: WSTypingEvent) => void;
type ReadCallback = (event: WSMessagesReadEvent) => void;
type OrderEventCallback = (event: WSOrderEvent) => void;

interface WebSocketChatContextType {
  // Connection state
  isConnected: boolean;
  connectionState: ConnectionState;
  connectionId: string | null;

  // Actor info
  actorType: ActorType | null;
  actorId: string | null;

  // Set/clear actor
  setActor: (type: ActorType, id: string) => void;
  clearActor: () => void;

  // Channel operations
  subscribe: (orderId: string) => void;
  unsubscribe: (orderId: string) => void;
  isSubscribed: (orderId: string) => boolean;

  // Send operations
  sendMessage: (orderId: string, content: string, messageType?: MessageType, imageUrl?: string) => void;
  sendTyping: (orderId: string, isTyping: boolean) => void;
  markRead: (orderId: string) => void;
  sendRaw: (message: object) => void;

  // Event listeners
  onMessage: (callback: MessageCallback) => () => void;
  onTyping: (callback: TypingCallback) => () => void;
  onRead: (callback: ReadCallback) => () => void;
  onOrderEvent: (callback: OrderEventCallback) => () => void;

  // Manual reconnect
  reconnect: () => void;
}

const WebSocketChatContext = createContext<WebSocketChatContextType | null>(null);

interface WebSocketChatProviderProps {
  children: ReactNode;
}

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;
const PING_INTERVAL = 25000;

export function WebSocketChatProvider({ children }: WebSocketChatProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [actorType, setActorType] = useState<ActorType | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const subscribedOrdersRef = useRef<Set<string>>(new Set());
  const pendingSubscriptionsRef = useRef<Set<string>>(new Set());
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  // Ref to `connect`, set on every render. Lets the retry scheduler call
  // the latest `connect` without forming a useCallback dep cycle.
  const connectRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Event callbacks
  const messageCallbacksRef = useRef<Set<MessageCallback>>(new Set());
  const typingCallbacksRef = useRef<Set<TypingCallback>>(new Set());
  const readCallbacksRef = useRef<Set<ReadCallback>>(new Set());
  const orderEventCallbacksRef = useRef<Set<OrderEventCallback>>(new Set());

  // Calculate retry delay with exponential backoff
  const getRetryDelay = useCallback(() => {
    const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCountRef.current);
    return Math.min(delay, MAX_RETRY_DELAY);
  }, []);

  // Send message to WebSocket
  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Start ping interval
  const startPing = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    pingIntervalRef.current = setInterval(() => {
      send({ type: 'ping' });
    }, PING_INTERVAL);
  }, [send]);

  // Stop ping interval
  const stopPing = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    stopPing();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    subscribedOrdersRef.current.clear();
    pendingSubscriptionsRef.current.clear();
  }, [stopPing]);

  // Handle incoming message
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data) as ServerMessage;

      switch (message.type) {
        case 'connected': {
          setConnectionId(message.connectionId);

          // Re-subscribe to ALL rooms after (re)connect — not just the ones
          // currently in `pending`. The server has no memory of our previous
          // subscriptions on a fresh socket, and `subscribed` was a
          // client-side cache of "the previous socket had these rooms."
          // Without this, any room that completed its subscribe-success
          // handshake before the disconnect would silently stop receiving
          // messages until the consumer re-subscribed manually (e.g. via
          // page reload), even though `isConnected` shows green.
          //
          // Move everything back into `pending` so the existing
          // chat:subscribed handler promotes each room as the server
          // confirms it.
          const toResubscribe = [
            ...subscribedOrdersRef.current,
            ...pendingSubscriptionsRef.current,
          ];
          subscribedOrdersRef.current.clear();
          pendingSubscriptionsRef.current.clear();
          toResubscribe.forEach((orderId) => {
            pendingSubscriptionsRef.current.add(orderId);
            send({ type: 'chat:subscribe', orderId });
          });
          break;
        }

        case 'pong':
          // Heartbeat received
          break;

        case 'chat:subscribed':
          if (message.success) {
            subscribedOrdersRef.current.add(message.orderId);
            pendingSubscriptionsRef.current.delete(message.orderId);

          } else {
            console.error('[WebSocket] Subscription failed:', message.orderId, message.error);
            pendingSubscriptionsRef.current.delete(message.orderId);
          }
          break;

        case 'chat:unsubscribed':
          subscribedOrdersRef.current.delete(message.orderId);

          break;

        case 'chat:message-new':
          messageCallbacksRef.current.forEach((cb) => cb(message as WSNewMessageEvent));
          break;

        case 'chat:typing-start':
        case 'chat:typing-stop':
          typingCallbacksRef.current.forEach((cb) => cb(message as WSTypingEvent));
          break;

        case 'chat:messages-read':
          readCallbacksRef.current.forEach((cb) => cb(message as WSMessagesReadEvent));
          break;

        case 'order:status-updated':
        case 'order:created':
        case 'order:cancelled':

          orderEventCallbacksRef.current.forEach((cb) => cb(message as WSOrderEvent));
          break;

        case 'error':
          console.error('[WebSocket] Error:', message.code, message.message);
          break;
      }
    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error);
    }
  }, [send]);

  // Connect to WebSocket.
  //
  // Auth: we fetch a single-use, short-lived ticket from POST /api/ws/ticket
  // (cookie auth, no body). The ticket is passed in `Sec-WebSocket-Protocol`
  // — the only header a browser can set on `new WebSocket(...)`. The server
  // atomically consumes the ticket on upgrade and derives actorType/actorId
  // from the consumed payload. No tokens in the URL, no localStorage reads,
  // no client-asserted identity.
  const connect = useCallback(async () => {
    if (!actorType || !actorId || !isMountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionState('connecting');

    // Mint a fresh ticket for every connect attempt. Tickets are single-use
    // by design — replays after a network blip MUST get a new ticket.
    let ticket: string | null = null;
    try {
      const res = await fetch('/api/ws/ticket', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        console.warn('[WebSocket] Ticket request failed:', res.status);
        // 401 → auth cookie expired; user needs a real re-login. We let the
        // existing reconnection backoff handle this; the next attempt may
        // succeed if a refresh interceptor rotated the cookie in the
        // meantime.
        setConnectionState(retryCountRef.current >= MAX_RETRIES ? 'failed' : 'reconnecting');
        scheduleReconnect();
        return;
      }
      const json = await res.json();
      ticket = json?.data?.ticket ?? null;
    } catch (err) {
      console.warn('[WebSocket] Ticket fetch threw:', err);
      setConnectionState('reconnecting');
      scheduleReconnect();
      return;
    }
    if (!ticket) {
      console.warn('[WebSocket] No ticket returned');
      setConnectionState('reconnecting');
      scheduleReconnect();
      return;
    }
    if (!isMountedRef.current) {
      // Tab unmounted while ticket was in flight — discard. The mint cost
      // is sub-millisecond and the unused ticket expires in ~45s anyway.
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    // No actorType / actorId / token in the URL — the server derives the
    // identity from the ticket. The URL stays free of any auth material.
    const url = `${protocol}//${host}/ws/chat`;

    try {
      const ws = new WebSocket(url, ['bearer', ticket]);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;

        setIsConnected(true);
        setConnectionState('connected');
        retryCountRef.current = 0;
        startPing();
      };

      ws.onclose = (event) => {
        if (!isMountedRef.current) return;

        setIsConnected(false);
        setConnectionId(null);
        stopPing();

        // Handle reconnection. Each retry mints a fresh ticket — by design.
        if (event.code !== 1000 && retryCountRef.current < MAX_RETRIES) {
          setConnectionState('reconnecting');
          retryCountRef.current++;
          scheduleReconnect();
        } else if (retryCountRef.current >= MAX_RETRIES) {
          setConnectionState('failed');
          console.warn('[WebSocket] Max retries reached — will retry in 30s');
          retryTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              retryCountRef.current = 0;
              void connect();
            }
          }, 30000);
        } else {
          setConnectionState('disconnected');
        }
      };

      ws.onerror = () => {
        console.warn('[WebSocket] Connection error — will retry');
      };

      ws.onmessage = handleMessage;
    } catch (error) {
      console.error('[WebSocket] Failed to create connection:', error);
      setConnectionState('failed');
    }
  // scheduleReconnect is declared below; eslint exhaustive-deps would flag
  // it, but the ref-based timer is intentional — reordering is awkward
  // because connect and scheduleReconnect are mutually recursive.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorType, actorId, handleMessage, startPing, stopPing, getRetryDelay]);

  // Keep the latest `connect` reachable through a ref so the retry
  // scheduler doesn't need it in a useCallback dep array (which would
  // create a circular dep with `connect` itself capturing scheduleReconnect).
  connectRef.current = connect;

  // Pulled out of `connect` because the two ticket-failure paths and the
  // onclose handler all schedule retries. Resolves connect via ref so its
  // identity changing on actor / dep updates doesn't ruin memoization.
  const scheduleReconnect = useCallback(() => {
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    const delay = getRetryDelay();

    retryTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) void connectRef.current();
    }, delay);
  }, [getRetryDelay]);

  // Initialize connection when actor is set
  useEffect(() => {
    isMountedRef.current = true;

    if (actorType && actorId) {
      const initTimeout = setTimeout(() => {
        void connect();
      }, 100);

      return () => {
        clearTimeout(initTimeout);
      };
    }

    return undefined;
  }, [actorType, actorId, connect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  // Set actor
  const setActor = useCallback((type: ActorType, id: string) => {

    setActorType(type);
    setActorId(id);
  }, []);

  // Clear actor and disconnect
  const clearActor = useCallback(() => {
    cleanup();
    setActorType(null);
    setActorId(null);
    setIsConnected(false);
    setConnectionState('disconnected');
    setConnectionId(null);
  }, [cleanup]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    cleanup();
    if (actorType && actorId) {
      void connect();
    }
  }, [actorType, actorId, cleanup, connect]);

  // Subscribe to order
  const subscribe = useCallback((orderId: string) => {
    if (subscribedOrdersRef.current.has(orderId)) return;

    pendingSubscriptionsRef.current.add(orderId);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send({ type: 'chat:subscribe', orderId });
    }
  }, [send]);

  // Unsubscribe from order
  const unsubscribe = useCallback((orderId: string) => {
    pendingSubscriptionsRef.current.delete(orderId);

    if (subscribedOrdersRef.current.has(orderId)) {
      send({ type: 'chat:unsubscribe', orderId });
      subscribedOrdersRef.current.delete(orderId);
    }
  }, [send]);

  // Check if subscribed
  const isSubscribed = useCallback((orderId: string) => {
    return subscribedOrdersRef.current.has(orderId);
  }, []);

  // Send chat message
  const sendMessage = useCallback((
    orderId: string,
    content: string,
    messageType: MessageType = 'text',
    imageUrl?: string
  ) => {
    send({
      type: 'chat:send',
      orderId,
      content,
      messageType,
      imageUrl,
    });
  }, [send]);

  // Send typing indicator
  const sendTyping = useCallback((orderId: string, isTyping: boolean) => {
    send({
      type: 'chat:typing',
      orderId,
      isTyping,
    });
  }, [send]);

  // Mark messages as read
  const markRead = useCallback((orderId: string) => {
    send({
      type: 'chat:mark-read',
      orderId,
    });
  }, [send]);

  // Register message callback
  const onMessage = useCallback((callback: MessageCallback) => {
    messageCallbacksRef.current.add(callback);
    return () => {
      messageCallbacksRef.current.delete(callback);
    };
  }, []);

  // Register typing callback
  const onTyping = useCallback((callback: TypingCallback) => {
    typingCallbacksRef.current.add(callback);
    return () => {
      typingCallbacksRef.current.delete(callback);
    };
  }, []);

  // Register read callback
  const onRead = useCallback((callback: ReadCallback) => {
    readCallbacksRef.current.add(callback);
    return () => {
      readCallbacksRef.current.delete(callback);
    };
  }, []);

  // Register order event callback
  const onOrderEvent = useCallback((callback: OrderEventCallback) => {
    orderEventCallbacksRef.current.add(callback);
    return () => {
      orderEventCallbacksRef.current.delete(callback);
    };
  }, []);

  // Raw send for compliance operations (highlight, freeze)
  const sendRaw = useCallback((message: object) => {
    send(message);
  }, [send]);

  const value: WebSocketChatContextType = {
    isConnected,
    connectionState,
    connectionId,
    actorType,
    actorId,
    setActor,
    clearActor,
    subscribe,
    unsubscribe,
    isSubscribed,
    sendMessage,
    sendTyping,
    markRead,
    sendRaw,
    onMessage,
    onTyping,
    onRead,
    onOrderEvent,
    reconnect,
  };

  return (
    <WebSocketChatContext.Provider value={value}>
      {children}
    </WebSocketChatContext.Provider>
  );
}

// Hook to use WebSocket chat context
export function useWebSocketChatContext(): WebSocketChatContextType {
  const context = useContext(WebSocketChatContext);
  if (!context) {
    throw new Error('useWebSocketChatContext must be used within a WebSocketChatProvider');
  }
  return context;
}

// Optional hook (won't throw if not in provider)
export function useWebSocketChatContextOptional(): WebSocketChatContextType | null {
  return useContext(WebSocketChatContext);
}
