"use client";

import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";

// Mounts the merchant presence heartbeat hook for the entire /merchant
// route tree from the layout. Without this, the hook only ran on the
// dashboard (/merchant) — a merchant sitting on /merchant/wallet,
// /merchant/settings, /merchant/my-issues, etc. produced no heartbeats,
// so admin's "Last Active" column froze at their login time.
//
// We deliberately do NOT gate on the merchant store's `merchantId` /
// `isLoggedIn` flags. Those flags are populated only by `useDashboardAuth`,
// which runs on `/merchant` and `/merchant/login` — not sub-routes. So a
// merchant who hard-refreshed on /merchant/wallet has cookie auth but
// `isLoggedIn === false` in the store, and any client-side gate would
// silently disable heartbeats for them. That was the production bug:
// authenticated tabs on sub-routes never pinged.
//
// Auth is enforced server-side. /api/presence/heartbeat returns 401 for
// unauthenticated requests, the hook silently swallows it, and the rate
// limiter (600/min) easily absorbs the worst case (a logged-out tab
// pinging twice per minute). When the cookie IS valid, the heartbeat
// flows naturally and updates merchants.last_seen_at.
export function MerchantPresenceHeartbeat() {
  usePresenceHeartbeat(true);
  return null;
}
