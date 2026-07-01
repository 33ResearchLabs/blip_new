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
  /** Non-null when the last load failed — lets the picker distinguish a load
   *  failure (offer a Retry) from a genuinely empty account list. */
  error: string | null;
  refetch: () => void;
} {
  const [methods, setMethods] = useState<RecvAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/merchant/me/payment-methods`);
      if (!res.ok) {
        setError("Couldn't load your payment methods.");
        return;
      }
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
      } else {
        // 200 but malformed / success:false — treat as a soft failure so the
        // picker doesn't mistake it for a genuinely empty account list.
        setError("Couldn't load your payment methods.");
      }
    } catch {
      // Keep any already-cached methods; the picker surfaces the error + Retry.
      setError("Couldn't load your payment methods.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  return { methods, loading, error, refetch: load };
}
