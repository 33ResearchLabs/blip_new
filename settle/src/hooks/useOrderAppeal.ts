"use client";

/**
 * useOrderAppeal
 * ──────────────
 * Reads the active appeal for an order (GET /api/orders/[id]/appeal) and lets a
 * participant respond to it (PUT /api/orders/[id]/appeal).
 *
 *   respond('agree')  → (mutual_cancel only) order cancelled + escrow refunded.
 *   respond('reject') → order escalated to a formal dispute.
 *
 * Polls on an interval so the counterparty sees a freshly-opened request and the
 * opener sees it resolve, even without a realtime event. Best-effort: poll
 * failures are swallowed; the action calls surface errors.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { orderActionKey } from "@/lib/api/idempotencyKeys";

export type AppealStatus =
  | "open"
  | "proposed"
  | "resolved"
  | "cancelled"
  | "escalated"
  | "expired";

export interface OrderAppeal {
  id: string;
  order_id: string;
  opened_by: "user" | "merchant" | "system";
  opener_id: string;
  issue_key: string;
  issue_group: string;
  description: string | null;
  status: AppealStatus;
  proposed_resolution: string | null;
  appeal_deadline: string;
  created_at: string;
}

export type AppealRespondAction = "agree" | "reject";

export interface AppealRespondResult {
  ok: boolean;
  disputed?: boolean;
  cancelled?: boolean;
  error?: string;
}

interface UseOrderAppealResult {
  appeal: OrderAppeal | null;
  viewerRole: "buyer" | "seller" | null;
  loading: boolean;
  responding: AppealRespondAction | null;
  error: string | null;
  refetch: () => Promise<void>;
  respond: (action: AppealRespondAction) => Promise<AppealRespondResult>;
}

const ACTIVE_APPEAL_STATUSES: AppealStatus[] = ["open", "proposed"];

/** True when the appeal is still awaiting a response (open or proposed). */
export function isActiveAppeal(a: OrderAppeal | null | undefined): boolean {
  return !!a && ACTIVE_APPEAL_STATUSES.includes(a.status);
}

export function useOrderAppeal(
  orderId: string | null | undefined,
  opts?: { enabled?: boolean; pollMs?: number },
): UseOrderAppealResult {
  const enabled = opts?.enabled ?? true;
  const pollMs = opts?.pollMs ?? 8000;

  const [appeal, setAppeal] = useState<OrderAppeal | null>(null);
  const [viewerRole, setViewerRole] = useState<"buyer" | "seller" | null>(null);
  const [loading, setLoading] = useState(false);
  const [responding, setResponding] = useState<AppealRespondAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/appeal`, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (res.ok && data?.success) {
        setAppeal(data.data?.appeal ?? null);
        setViewerRole(data.data?.viewerRole ?? null);
      }
    } catch {
      /* best-effort poll — ignore */
    }
  }, [orderId]);

  useEffect(() => {
    mountedRef.current = true;
    if (!orderId || !enabled) {
      setAppeal(null);
      return () => {
        mountedRef.current = false;
      };
    }
    setLoading(true);
    void refetch().finally(() => {
      if (mountedRef.current) setLoading(false);
    });
    const t = setInterval(() => void refetch(), pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(t);
    };
  }, [orderId, enabled, pollMs, refetch]);

  const respond = useCallback(
    async (action: AppealRespondAction): Promise<AppealRespondResult> => {
      if (!orderId) return { ok: false, error: "No order" };
      setResponding(action);
      setError(null);
      try {
        const res = await fetchWithAuth(`/api/orders/${orderId}/appeal`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": orderActionKey(orderId, `appeal_${action}`),
          },
          body: JSON.stringify({ action }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.success) {
          await refetch();
          return { ok: true, disputed: !!data.disputed, cancelled: !!data.cancelled };
        }
        const msg = data?.error || "Failed to respond. Please try again.";
        if (mountedRef.current) setError(msg);
        return { ok: false, error: msg };
      } catch {
        const msg = "Failed to respond. Please try again.";
        if (mountedRef.current) setError(msg);
        return { ok: false, error: msg };
      } finally {
        if (mountedRef.current) setResponding(null);
      }
    },
    [orderId, refetch],
  );

  return { appeal, viewerRole, loading, responding, error, refetch, respond };
}
