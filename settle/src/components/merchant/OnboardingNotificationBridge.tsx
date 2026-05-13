'use client';

/**
 * Bridges the onboarding context to the merchant notifications panel.
 *
 * When the merchant has skipped the onboarding overlay but hasn't yet
 * finished setup, this dispatches a single "system" notification into
 * the existing notifications list — the same surface that shows order
 * events, escrow updates, and the welcome-back banner.
 *
 * No UI of its own. Renders null.
 *
 * Dedup: useNotifications.addNotification dedupes by (orderId, type,
 * message) inside its batch logic, so re-firing this effect from the
 * provider's auto-refresh polling is safe — the notification only
 * appears once per session.
 */

import { useEffect, useRef } from 'react';
import type { Notification } from '@/types/merchant';
import { useOnboarding } from '@/contexts/OnboardingContext';

interface Props {
  addNotification: (
    type: Notification['type'],
    message: string,
    orderId?: string,
    opts?: { sticky?: boolean; priority?: 'high' | 'normal' }
  ) => void;
}

/**
 * Sentinel orderId carried on the onboarding "setup incomplete" notification.
 * NotificationsPanel detects this value and dispatches a window event instead
 * of trying to look up a real order — see panel onClick handler.
 */
export const ONBOARDING_RESUME_NOTIFICATION_ID = '__onboarding_resume__';

/** Window event the panel emits and the bridge listens for. */
const RESUME_EVENT = 'onboarding:resume-requested';

export function OnboardingNotificationBridge({ addNotification }: Props) {
  const { enabled, status, resume } = useOnboarding();
  // Belt-and-braces: prevent re-firing within the same session even if
  // addNotification's dedup is bypassed (e.g. message text changes
  // between renders). Once we've notified, stay quiet for this mount.
  const firedRef = useRef(false);

  const skipped = !!status?.skipped_at;
  const completed = !!status?.completed_at;

  useEffect(() => {
    if (!enabled || !status) return;
    if (!skipped || completed) return;
    if (firedRef.current) return;
    firedRef.current = true;

    const doneCount = [
      status.conditions.usernameSet,
      status.conditions.walletConnected,
      status.conditions.hasPaymentMethod,
      status.conditions.walletFunded,
      status.conditions.hasTrade,
    ].filter(Boolean).length;

    // The sentinel orderId travels with the notification so the panel can
    // recognise it and dispatch the resume event when clicked.
    addNotification(
      'system',
      `Setup incomplete — ${doneCount}/5 done. Finish to appear online to other traders.`,
      ONBOARDING_RESUME_NOTIFICATION_ID
    );
  }, [enabled, status, skipped, completed, addNotification]);

  // Reset the "fired" gate when the merchant resumes (skipped cleared)
  // so a subsequent skip in the same session re-dispatches.
  useEffect(() => {
    if (!skipped) firedRef.current = false;
  }, [skipped]);

  // Click → resume. The panel dispatches the event when the notification
  // with our sentinel orderId is clicked; this bridge lives inside the
  // OnboardingProvider tree so it can call resume() directly.
  useEffect(() => {
    if (!enabled) return;
    const handler = () => { void resume(); };
    window.addEventListener(RESUME_EVENT, handler);
    return () => window.removeEventListener(RESUME_EVENT, handler);
  }, [enabled, resume]);

  return null;
}
