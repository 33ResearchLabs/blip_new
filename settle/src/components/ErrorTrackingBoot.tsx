'use client';

/**
 * Boot-time installer for the global client-side error handlers.
 *
 * Mounts once in the root layout; subsequent renders are no-ops thanks to
 * the guard inside `installGlobalClientErrorHandlers`. Safe to ship even
 * when the error-tracking feature flag is off — the installer itself short
 * circuits when `NEXT_PUBLIC_ENABLE_ERROR_TRACKING !== 'true'`.
 */

import { useEffect } from 'react';
import { installGlobalClientErrorHandlers } from '@/lib/errorTracking/clientLogger';

function readJson<T = Record<string, unknown>>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export default function ErrorTrackingBoot() {
  useEffect(() => {
    installGlobalClientErrorHandlers(() => {
      // Best-effort: pick up whichever actor is currently logged in on this
      // browser. Reading localStorage is cheap and the logger catches any
      // thrown errors.
      try {
        const merchant = readJson<{ id?: string }>('blip_merchant');
        const user = readJson<{ id?: string }>('blip_user');
        return {
          userId: user?.id || null,
          merchantId: merchant?.id || null,
        };
      } catch {
        return {};
      }
    });
  }, []);

  return null;
}
