"use client";

/**
 * Per-merchant editable dashboard layout (migration 146 + widgetRegistry).
 *
 * Reads the layout from the merchant store (hydrated by /api/auth/me on
 * mount), falls back to the screen-size-aware default when null, and
 * exposes:
 *   - layout: the reconciled DashboardLayout (always renderable)
 *   - updateLayout(next): optimistic local update + debounced PATCH
 *   - resetToDefault(): clears the column to NULL so future loads use
 *     the default-for-this-viewport
 *
 * PATCH cadence is intentionally lazy — drag/drop emits many small mutations
 * during a single edit session; the 800ms debounce batches them into one
 * round-trip and keeps `merchants.updated_at` from churning.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { useMerchantStore } from "@/stores/merchantStore";
import type { DashboardLayout } from "@/lib/validation/schemas";
import {
  getDefaultLayout,
  reconcileLayout,
} from "@/components/merchant/dashboard/widgetRegistry";

const PATCH_DEBOUNCE_MS = 800;

export interface UseDashboardLayoutResult {
  layout: DashboardLayout;
  /** True until the merchant row has hydrated. Render the default during
   *  hydration — the eventual real layout, if any, replaces it seamlessly. */
  isHydrated: boolean;
  /** Optimistic local update; PATCH fires after PATCH_DEBOUNCE_MS of quiet. */
  updateLayout: (next: DashboardLayout) => void;
  /** Persist `dashboard_layout: null` → future loads pick the default. */
  resetToDefault: () => void;
}

export function useDashboardLayout(
  isWideScreen: boolean,
): UseDashboardLayoutResult {
  const merchantId = useMerchantStore((s) => s.merchantId);
  const merchantInfo = useMerchantStore((s) => s.merchantInfo);
  const setMerchantInfo = useMerchantStore((s) => s.setMerchantInfo);

  const fallback = useMemo(() => getDefaultLayout(isWideScreen), [isWideScreen]);

  // Local override — set when the user drags. Wins over merchantInfo so
  // the optimistic UI doesn't flicker back to the server value while the
  // debounce is still pending. Cleared on successful PATCH (server is now
  // authoritative again).
  const [localOverride, setLocalOverride] = useState<DashboardLayout | null>(
    null,
  );

  const raw =
    (merchantInfo as { dashboard_layout?: unknown } | null)?.dashboard_layout ??
    null;

  const layout = useMemo(
    () => reconcileLayout(localOverride ?? raw, fallback),
    [localOverride, raw, fallback],
  );

  const isHydrated = merchantInfo != null;

  // Debounced PATCH — coalesces a burst of drag-end events into one
  // round-trip. The ref pattern dodges stale-closure bugs across renders.
  const pendingRef = useRef<DashboardLayout | null | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (!merchantId) return;
    const payload = pendingRef.current;
    if (payload === undefined) return;
    pendingRef.current = undefined;

    try {
      const res = await fetchWithAuth(`/api/merchant/${merchantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboard_layout: payload }),
      });
      if (!res.ok) {
        // Don't clear the override on failure — the user's local layout is
        // still what they want to see. Surface the error via console only;
        // a future Phase 2 surface can show a toast.
        console.warn("[useDashboardLayout] PATCH failed", res.status);
        return;
      }
      const data = await res.json().catch(() => null);
      const updated = data?.data?.dashboard_layout;
      // Mirror the server value back into the store so the next consumer
      // (e.g. a settings page) sees what was actually persisted.
      setMerchantInfo((prev: any) =>
        prev ? { ...prev, dashboard_layout: updated ?? payload } : prev,
      );
      setLocalOverride(null);
    } catch (err) {
      console.warn("[useDashboardLayout] PATCH threw", err);
    }
  }, [merchantId, setMerchantInfo]);

  const schedule = useCallback(
    (payload: DashboardLayout | null) => {
      pendingRef.current = payload;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, PATCH_DEBOUNCE_MS);
    },
    [flush],
  );

  const updateLayout = useCallback(
    (next: DashboardLayout) => {
      setLocalOverride(next);
      schedule(next);
    },
    [schedule],
  );

  const resetToDefault = useCallback(() => {
    setLocalOverride(null);
    schedule(null);
  }, [schedule]);

  // Flush any pending PATCH on unmount so a navigation away mid-edit
  // doesn't strand the change.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        void flush();
      }
    };
  }, [flush]);

  return { layout, isHydrated, updateLayout, resetToDefault };
}
