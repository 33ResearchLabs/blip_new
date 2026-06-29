"use client";

/**
 * useRealtimeResync — run a refetch whenever the app may have missed realtime
 * events, so the UI never shows stale state after a gap.
 *
 * Fires `onResync` on:
 *   - Pusher reconnect      (isConnected transitions false -> true)
 *   - tab becomes visible   (returning to a backgrounded tab)
 *   - browser comes online  (network restored)
 *
 * It deliberately does NOT fire on initial mount (callers do their own initial
 * fetch), and the Pusher path only fires on an actual false->true transition —
 * never on every render — using a previous-state ref (mirrors the existing
 * `useOrderReconciliation` pattern). This makes it safe to drop into any data
 * hook without causing refetch storms.
 *
 * Adds no UI; it only triggers data refreshes the caller already owns.
 */
import { useEffect, useRef } from 'react';
import { usePusherOptional } from '@/context/PusherContext';

export function useRealtimeResync(onResync: () => void, enabled: boolean = true): void {
  const pusher = usePusherOptional();
  const isConnected = pusher?.isConnected ?? false;

  // Latest callback without re-binding listeners every render. Synced in an
  // effect (not during render) to satisfy the react-hooks "refs" rule.
  const cbRef = useRef(onResync);
  useEffect(() => {
    cbRef.current = onResync;
  });

  const prevConnectedRef = useRef(isConnected);

  // Pusher reconnect: false -> true only.
  useEffect(() => {
    const was = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;
    if (!enabled) return;
    if (!was && isConnected) cbRef.current();
  }, [isConnected, enabled]);

  // Tab visibility + network online.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') cbRef.current();
    };
    const onOnline = () => cbRef.current();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled]);
}
