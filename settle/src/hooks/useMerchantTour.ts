'use client';

/**
 * Merchant onboarding tour logic.
 *
 * Controlled by env var NEXT_PUBLIC_ENABLE_APP_TOUR.
 * - If "false" or unset → tour disabled for everyone (kill switch)
 * - If "true" → tour shows once per merchant (tracked in localStorage)
 *
 * Users can manually restart via `restartTour()`.
 *
 * Zero regression: when env var is false/unset, this hook does nothing.
 */

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'blip_merchant_tour_completed';

export function useMerchantTour(merchantId: string | null) {
  const [isRunning, setIsRunning] = useState(false);
  const enabled = process.env.NEXT_PUBLIC_ENABLE_APP_TOUR === 'true';

  // Check if tour should start on mount
  useEffect(() => {
    if (!enabled || !merchantId) return;
    if (typeof window === 'undefined') return;

    try {
      const completed = localStorage.getItem(`${STORAGE_KEY}_${merchantId}`);
      if (completed !== 'true') {
        // Small delay so the dashboard renders first
        const t = setTimeout(() => setIsRunning(true), 1500);
        return () => clearTimeout(t);
      }
    } catch {
      // localStorage unavailable — skip tour
    }
  }, [enabled, merchantId]);

  const completeTour = useCallback(() => {
    setIsRunning(false);
    if (!merchantId) return;
    try {
      localStorage.setItem(`${STORAGE_KEY}_${merchantId}`, 'true');
    } catch { /* ignore */ }
  }, [merchantId]);

  const restartTour = useCallback(() => {
    if (!merchantId) return;
    try {
      localStorage.removeItem(`${STORAGE_KEY}_${merchantId}`);
    } catch { /* ignore */ }
    setIsRunning(true);
  }, [merchantId]);

  return {
    enabled,
    isRunning,
    completeTour,
    restartTour,
  };
}
