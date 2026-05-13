"use client";

import { useEffect, useState } from "react";

/**
 * Returns the running context of the page:
 *   - standalone: true when the page is open as an installed PWA
 *   - app: 'user' | 'merchant' | null — set if a manifest start_url tagged
 *          the session with ?pwa=… (see PwaAppGuard for the capture).
 *          null in regular browsers OR for legacy PWA installs that
 *          haven't captured the tag yet.
 *
 * Use this to hide cross-app CTAs (e.g. the "Merchant" switch on the
 * User PWA) without affecting the browser experience.
 */
export function usePwaContext() {
  const [state, setState] = useState<{
    standalone: boolean;
    app: "user" | "merchant" | null;
  }>({ standalone: false, app: null });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // @ts-expect-error legacy iOS
      window.navigator?.standalone === true;
    let app: "user" | "merchant" | null = null;
    try {
      const s = sessionStorage.getItem("blip_pwa_app");
      if (s === "user" || s === "merchant") app = s;
    } catch { /* */ }
    setState({ standalone, app });
  }, []);

  return state;
}
