'use client';

import { useEffect } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

/**
 * Pings /api/presence/heartbeat every 30s to keep the current actor's
 * chat_presence row fresh. Sends an offline beacon on tab close/hide.
 *
 * Mount this once in the authenticated app shell (merchant page, user app).
 */
export function usePresenceHeartbeat(enabled: boolean = true) {
  useEffect(() => {
    console.log('[presence-heartbeat] hook mount, enabled =', enabled);
    if (!enabled) return;
    let cancelled = false;

    const ping = async (isOnline: boolean = true) => {
      try {
        const res = await fetchWithAuth('/api/presence/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isOnline }),
        });
        const data = await res.json().catch(() => null);
        console.log('[presence-heartbeat] ping →', res.status, data);
      } catch (err) {
        console.error('[presence-heartbeat] ping error', err);
      }
    };

    // Initial ping + interval
    ping(true);
    const interval = setInterval(() => {
      if (!cancelled && document.visibilityState === 'visible') ping(true);
    }, 30_000);

    // Mark offline on tab close / navigate away (best-effort beacon)
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
