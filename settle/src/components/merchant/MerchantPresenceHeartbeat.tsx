"use client";

import { useMerchantStore } from "@/stores/merchantStore";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";

// Mounts the merchant presence heartbeat hook for the entire /merchant
// route tree from the layout. Without this, the hook only ran on the
// dashboard (/merchant) — a merchant sitting on /merchant/wallet,
// /merchant/settings, /merchant/my-issues, etc. produced no heartbeats,
// so admin's "Last Active" column froze at their login time.
//
// Gated on the merchant store's `merchantId` AND `isLoggedIn` so the
// hook is a no-op on /merchant/login, /merchant/forgot-password,
// /merchant/verify-email, etc., and for any visitor who hasn't
// authenticated yet. The store is populated by useDashboardAuth on
// the dashboard / login pages and persists for the rest of the
// in-app session.
export function MerchantPresenceHeartbeat() {
  const merchantId = useMerchantStore((s) => s.merchantId);
  const isLoggedIn = useMerchantStore((s) => s.isLoggedIn);
  usePresenceHeartbeat(!!merchantId && isLoggedIn);
  return null;
}
