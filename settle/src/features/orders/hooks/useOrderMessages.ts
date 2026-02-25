'use client';

/**
 * useOrderMessages — UI state wrapper for fetching & sending messages
 *
 * This is a SIMPLE fetch wrapper. For real-time chat with polling,
 * Pusher bindings, and multi-window management, continue using the
 * existing useChat / useRealtimeChat hooks.
 */

import { useState, useCallback } from 'react';
import {
  getMessages,
  sendMessage,
  markMessagesRead,
  type SendMessageParams,
} from '../services/messages.service';

interface UseOrderMessagesReturn {
  messages: unknown[];
  isLoading: boolean;
  error: string | null;
  fetch: (orderId: string) => Promise<void>;
  send: (params: SendMessageParams) => Promise<unknown>;
  markRead: (orderId: string, readerType: 'user' | 'merchant') => Promise<void>;
}

export function useOrderMessages(): UseOrderMessagesReturn {
  const [messages, setMessages] = useState<unknown[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (orderId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await getMessages(orderId);
      setMessages(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const send = useCallback(async (params: SendMessageParams) => {
    try {
      const result = await sendMessage(params);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      throw err;
    }
  }, []);

  const markRead = useCallback(async (orderId: string, readerType: 'user' | 'merchant') => {
    try {
      await markMessagesRead({ orderId, reader_type: readerType });
    } catch {
      // Non-critical — don't surface to UI
    }
  }, []);

  return { messages, isLoading, error, fetch, send, markRead };
}
