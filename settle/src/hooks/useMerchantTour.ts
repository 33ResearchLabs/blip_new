'use client';

/**
 * Merchant onboarding tour logic.
 *
 * Controlled by env var NEXT_PUBLIC_ENABLE_APP_TOUR.
 * - If "false" or unset → tour disabled for everyone (kill switch)
 * - If "true" → tour shows once per merchant, tracked in both:
 *     1. DB (merchants.tour_completed_at) — authoritative across devices
 *     2. localStorage — cache for instant decision on mount
 *
 * Persistence strategy (zero-regression, progressive enhancement):
 * - On mount, check DB value first (passed in as `tourCompletedAt`).
 *   If DB says completed → skip tour.
 * - If DB value is null AND localStorage says completed → skip tour anyway
 *   and silently sync to DB (self-healing for users who completed the tour
 *   before DB persistence shipped).
 * - On completeTour: write localStorage immediately (instant UX), then
 *   fire-and-forget POST /api/merchant/complete-tour to persist.
 *
 * Users can manually restart via `restartTour()` (clears both stores).
 *
 * Zero regression: when env var is false/unset, this hook does nothing.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

const STORAGE_KEY = 'blip_merchant_tour_completed';

export function useMerchantTour(
  merchantId: string | null,
  tourCompletedAt?: string | null,
) {
  const [isRunning, setIsRunning] = useState(false);
  const enabled = process.env.NEXT_PUBLIC_ENABLE_APP_TOUR === 'true';

  // Check if tour should start on mount. Waits for merchantId AND for
  // tourCompletedAt to be resolved (undefined = still loading, null = known
  // "never completed"). This prevents a flash of the tour before auth
  // response populates merchantInfo.
  useEffect(() => {
    if (!enabled || !merchantId) return;
    if (typeof window === 'undefined') return;

    // DB is authoritative — if merchant has tour_completed_at set, done.
    if (tourCompletedAt) {
      // Also mirror to localStorage so a subsequent load without the DB
      // value (e.g. offline-first render) still gets the fast path.
      try { localStorage.setItem(`${STORAGE_KEY}_${merchantId}`, 'true'); } catch { /* ignore */ }
      return;
    }

    // Still loading merchant info — don't show tour yet.
    if (tourCompletedAt === undefined) return;

    // DB says not completed. Check localStorage for legacy state.
    let localCompleted = false;
    try {
      localCompleted = localStorage.getItem(`${STORAGE_KEY}_${merchantId}`) === 'true';
    } catch { /* ignore */ }

    if (localCompleted) {
      // User finished the tour before DB persistence shipped. Sync silently
      // so future visits hit the fast path — no UI interruption.
      void fetchWithAuth('/api/merchant/complete-tour', { method: 'POST' }).catch(() => { /* best-effort */ });
      return;
    }

    // Fresh merchant OR first time ever — show the tour after a small
    // delay so the dashboard renders first.
    const t = setTimeout(() => setIsRunning(true), 1500);
    return () => clearTimeout(t);
  }, [enabled, merchantId, tourCompletedAt]);

  const completeTour = useCallback(() => {
    setIsRunning(false);
    if (!merchantId) return;
    // 1. Update localStorage synchronously for instant next-load skip.
    try {
      localStorage.setItem(`${STORAGE_KEY}_${merchantId}`, 'true');
    } catch { /* ignore */ }
    // 2. Persist to DB — fire-and-forget. Any failure leaves localStorage
    //    as the source of truth for this session; next auth response will
    //    attempt the sync again via the localStorage-completed path.
    void fetchWithAuth('/api/merchant/complete-tour', { method: 'POST' }).catch(() => { /* best-effort */ });
  }, [merchantId]);

  const restartTour = useCallback(() => {
    if (!merchantId) return;
    try {
      localStorage.removeItem(`${STORAGE_KEY}_${merchantId}`);
    } catch { /* ignore */ }
    // NOTE: restartTour does NOT clear the DB timestamp. Resetting the DB
    // field should be an admin action (support / compliance), not a client
    // operation. If the user really wants to replay, this session shows it
    // again (isRunning=true), and on next login the DB will re-suppress it.
    setIsRunning(true);
  }, [merchantId]);

  return {
    enabled,
    isRunning,
    completeTour,
    restartTour,
  };
}
