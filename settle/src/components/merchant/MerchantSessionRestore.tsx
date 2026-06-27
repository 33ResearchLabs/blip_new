"use client";

import { useEffect, useRef } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

/**
 * MerchantSessionRestore
 * ──────────────────────
 * Repopulates the in-memory merchant store from the httpOnly session cookie on
 * a fresh page load. Mounted once at the market layout level so EVERY merchant
 * sub-route (chat, analytics, profile, rewards, my-issues, …) gets its identity
 * back on a hard refresh — not just the dashboard.
 *
 * Why this exists: the merchant store is never persisted (see merchantStore —
 * `merchantId` boots as null on every reload), and only a handful of pages
 * (`/market`, `/market/settings`, …) run `useDashboardAuth`, which does the
 * `/api/auth/me` restore. Landing directly on a page that DIDN'T run it — most
 * visibly `/market/chat` — left `merchantId` null forever, so the conversation
 * fetch, the Pusher actor, and the realtime chat (all gated on `merchantId`)
 * never fired and the page rendered empty.
 *
 * This mirrors the restore in `useDashboardAuth` but trimmed to the identity
 * essentials — it deliberately does NOT touch `isLoading`, the wallet prompt,
 * or any dashboard-specific UI state. On pages that still mount
 * `useDashboardAuth` both restores run; that's safe — `/api/auth/me` is an
 * idempotent GET and `fetchWithAuth` coalesces the silent refresh into a single
 * in-flight call, so the refresh-token cookie is never rotated twice.
 */
export function MerchantSessionRestore() {
  const setMerchantId = useMerchantStore((s) => s.setMerchantId);
  const setMerchantInfo = useMerchantStore((s) => s.setMerchantInfo);
  const setIsLoggedIn = useMerchantStore((s) => s.setIsLoggedIn);
  const setSessionToken = useMerchantStore((s) => s.setSessionToken);

  // Run the restore at most once per full page load (the layout mounts once and
  // survives client-side navigation, so this never re-fires on in-app nav). The
  // ref also absorbs React StrictMode's dev double-invoke.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // If identity is already in the store (e.g. we navigated in from a page
    // that already restored), there's nothing to do.
    if (useMerchantStore.getState().merchantId) return;

    const restore = async () => {
      try {
        const res = await fetchWithAuth("/api/auth/me", {
          method: "GET",
          credentials: "include",
          // Probe semantics: attempt one cookie-based silent refresh on a 401
          // (the in-memory sessionToken mirror is null on a fresh load) and
          // never force-logout / redirect — a genuinely signed-out visitor
          // just gets the 401 back and we leave the store logged-out.
          sessionProbe: true,
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (
            data?.success &&
            data?.data?.actorType === "merchant" &&
            data?.data?.merchant?.id
          ) {
            const m = data.data.merchant;
            setMerchantId(m.id);
            setMerchantInfo(m);
            setIsLoggedIn(true);
            // Mirror the cookie's existence so fetchWithAuth's refresh gate
            // (`!!sessionToken`) fires when the 15-min access cookie expires.
            setSessionToken("cookie-session");
            return;
          }
        }
        // 401 / non-merchant actor / shape mismatch → not signed in.
        setIsLoggedIn(false);
        setMerchantId(null);
        setMerchantInfo(null);
        setSessionToken(null);
      } catch {
        setIsLoggedIn(false);
        setMerchantId(null);
        setMerchantInfo(null);
        setSessionToken(null);
      }
    };
    void restore();
  }, [setMerchantId, setMerchantInfo, setIsLoggedIn, setSessionToken]);

  return null;
}
