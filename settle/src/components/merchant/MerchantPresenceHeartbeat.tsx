"use client";

import { useMerchantStore } from "@/stores/merchantStore";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";

// Mounts the merchant presence heartbeat hook for the entire /merchant
// route tree from the layout. Without this, the hook only ran on the
// dashboard (/merchant) — a merchant sitting on /merchant/wallet,
// /merchant/settings, /merchant/my-issues, etc. produced no heartbeats,
// so admin's "Last Active" column froze at their login time.
//
// `enabled` is gated by both merchantId AND isLoggedIn so the hook is a
// no-op on /merchant/login, /merchant/forgot-password, etc. (where the
// store hasn't populated those values yet).
export function MerchantPresenceHeartbeat() {
  const merchantId = useMerchantStore((s) => s.merchantId);
  const isLoggedIn = useMerchantStore((s) => s.isLoggedIn);
  usePresenceHeartbeat(!!merchantId && isLoggedIn);
  return null;
}
