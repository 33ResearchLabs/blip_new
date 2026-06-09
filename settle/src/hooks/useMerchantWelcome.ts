"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const WELCOME_KEY = "blip_merchant_welcome_v1";
const NOTIF_KEY = "blip_merchant_welcome_notif_v1";

/**
 * Welcome flow for Blip Markets (merchant app).
 *
 * New merchants  → full-screen 3-slide welcome on first login.
 * Existing merchants → a one-time "Welcome to Blip Markets" notification
 *   injected into the notification list; clicking it re-opens the slides.
 *
 * Uses localStorage only (no new DB column needed).
 */
export function useMerchantWelcome(
  merchantId: string | null,
  tourCompletedAt: string | null | undefined,
  addNotification: (
    type: "system",
    message: string,
    orderId?: string,
    opts?: { sticky?: boolean; priority?: "high" | "normal" },
  ) => void,
) {
  const [showWelcome, setShowWelcome] = useState(false);
  const notifInjectedRef = useRef(false);

  useEffect(() => {
    if (!merchantId) return;

    let welcomed = false;
    let notifSent = false;
    try {
      welcomed = localStorage.getItem(`${WELCOME_KEY}_${merchantId}`) === "1";
      notifSent = localStorage.getItem(`${NOTIF_KEY}_${merchantId}`) === "1";
    } catch {}

    if (welcomed) return; // already completed the flow on this device

    // tourCompletedAt is undefined while merchant info is still loading —
    // don't act yet (avoids flash for existing merchants).
    if (tourCompletedAt === undefined) return;

    const isExisting = !!tourCompletedAt;

    if (!isExisting) {
      // Brand new merchant — show welcome screens after a short delay.
      const t = setTimeout(() => setShowWelcome(true), 800);
      return () => clearTimeout(t);
    } else {
      // Existing merchant — inject one notification they can tap to replay.
      if (!notifSent && !notifInjectedRef.current) {
        notifInjectedRef.current = true;
        try {
          localStorage.setItem(`${NOTIF_KEY}_${merchantId}`, "1");
        } catch {}
        // Small delay so the notification list is mounted before we push.
        const t = setTimeout(() => {
          addNotification(
            "system",
            "Welcome to Blip Markets — tap to see what's new",
          );
        }, 1200);
        return () => clearTimeout(t);
      }
    }
  }, [merchantId, tourCompletedAt, addNotification]);

  const completeWelcome = useCallback(() => {
    setShowWelcome(false);
    if (!merchantId) return;
    try {
      localStorage.setItem(`${WELCOME_KEY}_${merchantId}`, "1");
    } catch {}
  }, [merchantId]);

  // Called when the user taps the welcome notification.
  const openWelcomeFromNotif = useCallback(() => {
    setShowWelcome(true);
  }, []);

  return { showWelcome, completeWelcome, openWelcomeFromNotif };
}
