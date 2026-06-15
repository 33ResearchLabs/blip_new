"use client";

// Fetches the current merchant's saved payment methods for the Lock Escrow
// receiving-account picker. Uses the `me` alias (server resolves the merchant
// from the auth token) so it never races a not-yet-hydrated merchantId. Shared
// by EscrowLockModal and OrderQuickView. Returns a `refetch` for use after the
// merchant adds a new method.

import { useCallback, useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import type { RecvAccount } from "./ReceivingAccountPicker";

export function useMerchantReceivingMethods(enabled: boolean): {
  methods: RecvAccount[];
  loading: boolean;
  refetch: () => void;
} {
  const [methods, setMethods] = useState<RecvAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/merchant/me/payment-methods`);
      const j = await res.json().catch(() => null);
      if (j?.success && Array.isArray(j.data)) {
        setMethods(
          (j.data as RecvAccount[]).map((m) => ({
            id: String(m.id),
            type: m.type,
            name: m.name,
            details: m.details,
            is_default: !!m.is_default,
          })),
        );
      }
    } catch {
      /* best-effort — picker shows its empty state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  return { methods, loading, refetch: load };
}
