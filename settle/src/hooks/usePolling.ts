'use client';

import { useEffect, useRef, useCallback } from 'react';

// Hook for polling data at intervals
export function usePolling(
  callback: () => Promise<void>,
  interval: number,
  enabled: boolean = true
) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    // Call immediately
    savedCallback.current();

    // Then poll at interval
    const id = setInterval(() => {
      savedCallback.current();
    }, interval);

    return () => clearInterval(id);
  }, [interval, enabled]);
}

// Hook specifically for polling order status
export function useOrderPolling(
  orderId: string | null,
  onUpdate: (orderId: string) => Promise<void>,
  interval: number = 5000
) {
  const poll = useCallback(async () => {
    if (orderId) {
      await onUpdate(orderId);
    }
  }, [orderId, onUpdate]);

  usePolling(poll, interval, !!orderId);
}
