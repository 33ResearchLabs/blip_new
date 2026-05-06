'use client';

import { useEffect } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

const BASE_INTERVAL_MS = 30_000;

/**
 * Pings /api/presence/heartbeat every ~30s to keep the current actor's
 * chat_presence row fresh. Sends an offline beacon on tab close/hide.
 *
 * Mount this once in the authenticated app shell (merchant page, user app).
 *
 * Backoff: on a 429 we honor the Retry-After header (or fall back to 60s)
 * and skip pings until that window passes. Without this, the 30s tick keeps
 * burning the per-IP rate-limit bucket forever and prevents OTHER endpoints
 * from recovering.
 */
export function usePresenceHeartbeat(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let suppressUntil = 0;

    const ping = async (isOnline: boolean = true) => {
      if (Date.now() < suppressUntil) return;
      try {
        const res = await fetchWithAuth('/api/presence/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isOnline }),
        });
        if (res.status === 429) {
          const ra = parseInt(res.headers.get('Retry-After') || '0', 10);
          const waitMs = (ra > 0 ? ra : 60) * 1000;
          suppressUntil = Date.now() + waitMs;
        }
      } catch {
        // Network errors here are normal on tab unload — fetchWithAuth
        // already filters them out of the error log.
      }
    };

    // Add jitter so two tabs opened together don't sync their pings.
    const jitter = Math.floor(Math.random() * 5_000);

    ping(true);
    const interval = setInterval(() => {
      if (!cancelled && document.visibilityState === 'visible') ping(true);
    }, BASE_INTERVAL_MS + jitter);

    const handleUnload = () => { ping(false); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') ping(true);
    };
    window.addEventListener('beforeunload', handleUnload);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
      document.removeEventListener('visibilitychange', handleVisibility);
      ping(false);
    };
  }, [enabled]);
}
