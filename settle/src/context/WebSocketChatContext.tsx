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
        case 'connected':
          setConnectionId(message.connectionId);
          console.log('[WebSocket] Connected:', message.connectionId);

          // Re-subscribe to pending orders
          pendingSubscriptionsRef.current.forEach((orderId) => {
            send({ type: 'chat:subscribe', orderId });
          });
          break;

        case 'pong':
          // Heartbeat received
          break;

        case 'chat:subscribed':
          if (message.success) {
            subscribedOrdersRef.current.add(message.orderId);
            pendingSubscriptionsRef.current.delete(message.orderId);
            console.log('[WebSocket] Subscribed to order:', message.orderId);
          } else {
            console.error('[WebSocket] Subscription failed:', message.orderId, message.error);
            pendingSubscriptionsRef.current.delete(message.orderId);
          }
          break;

        case 'chat:unsubscribed':
          subscribedOrdersRef.current.delete(message.orderId);
          console.log('[WebSocket] Unsubscribed from order:', message.orderId);
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
          console.log('[WebSocket] Order event:', message.type, message);
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

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!actorType || !actorId || !isMountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionState('connecting');

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/chat?actorType=${actorType}&actorId=${actorId}`;

    console.log('[WebSocket] Connecting to:', url);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        console.log('[WebSocket] Connection opened');
        setIsConnected(true);
        setConnectionState('connected');
        retryCountRef.current = 0;
        startPing();
      };

      ws.onclose = (event) => {
        if (!isMountedRef.current) return;
        console.log('[WebSocket] Connection closed:', event.code, event.reason);
        setIsConnected(false);
        setConnectionId(null);
        stopPing();

        // Handle reconnection
        if (event.code !== 1000 && retryCountRef.current < MAX_RETRIES) {
          setConnectionState('reconnecting');
          retryCountRef.current++;
          const delay = getRetryDelay();
          console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${retryCountRef.current}/${MAX_RETRIES})`);

          retryTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              connect();
            }
          }, delay);
        } else if (retryCountRef.current >= MAX_RETRIES) {
          setConnectionState('failed');
          console.error('[WebSocket] Max retries reached');
        } else {
          setConnectionState('disconnected');
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
      };

      ws.onmessage = handleMessage;
    } catch (error) {
      console.error('[WebSocket] Failed to create connection:', error);
      setConnectionState('failed');
    }
  }, [actorType, actorId, handleMessage, startPing, stopPing, getRetryDelay]);

  // Initialize connection when actor is set
  useEffect(() => {
    isMountedRef.current = true;

    if (actorType && actorId) {
      const initTimeout = setTimeout(() => {
        connect();
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
    console.log('[WebSocket] setActor:', type, id);
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
      connect();
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
