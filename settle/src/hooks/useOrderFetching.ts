"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type {
  DbOrder,
  Order,
  LeaderboardEntry,
  BigOrderRequest,
} from "@/types/merchant";
import { getEffectiveStatus, mapDbOrderToUI } from "@/lib/orders/mappers";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

// Resolved dispute shape (inline — no separate type needed)
export interface ResolvedDispute {
  id: string;
  orderId: string;
  orderNumber: string;
  cryptoAmount: number;
  fiatAmount: number;
  otherPartyName: string;
  reason: string;
  resolution: string;
  resolvedInFavorOf: string;
  resolvedAt: string;
}

interface UseOrderFetchingParams {
  isMockMode: boolean;
  isPusherConnected: boolean;
  solanaUsdtBalance: number | null;
  solanaRefreshBalances: () => void;
}

export function useOrderFetching({
  isMockMode,
  isPusherConnected,
  solanaUsdtBalance,
  solanaRefreshBalances,
}: UseOrderFetchingParams) {
  // ─── Zustand store ───
  const setOrders = useMerchantStore((s) => s.setOrders);
  const merchantId = useMerchantStore((s) => s.merchantId);
  const setIsLoading = useMerchantStore((s) => s.setIsLoading);

  // ─── Local state ───
  const [activeOffers, setActiveOffers] = useState<
    { id: string; type: string; available_amount: number; is_active: boolean }[]
  >([]);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>(
    [],
  );
  const [inAppBalance, setInAppBalance] = useState<number | null>(
    isMockMode ? 10000 : null,
  );
  const [bigOrders, setBigOrders] = useState<BigOrderRequest[]>([]);
  const [mempoolOrders, setMempoolOrders] = useState<any[]>([]);
  const [resolvedDisputes, setResolvedDisputes] = useState<ResolvedDispute[]>(
    [],
  );

  // ─── Abort controllers ───
  const fetchAbortRef = useRef<AbortController | null>(null);
  const balanceAbortRef = useRef<AbortController | null>(null);
  const mempoolAbortRef = useRef<AbortController | null>(null);
  const disputesAbortRef = useRef<AbortController | null>(null);
  const bigOrdersAbortRef = useRef<AbortController | null>(null);
  const offersAbortRef = useRef<AbortController | null>(null);

  // ─── Debounce refs ───
  const fetchPendingRef = useRef(false);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Mempool visibility ───
  const [isMempoolVisible, setIsMempoolVisible] = useState(false);
  // Ref avoids restarting polling effects when visibility toggles
  const isMempoolVisibleRef = useRef(isMempoolVisible);
  isMempoolVisibleRef.current = isMempoolVisible;

  // ─── Polling refs ───
  const prevPusherConnected = useRef(isPusherConnected);
  const lastSyncRef = useRef<number>(Date.now());

  // ─── Pagination state ───
  const nextCursorRef = useRef<string | null>(null);
  const [hasMoreOrders, setHasMoreOrders] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // ═══════════════════════════════════════════════════════════════════
  // FETCH FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════

  const fetchOrders = useCallback(async () => {
    console.log(merchantId, "merchant id is this ");
    if (!merchantId) {
      setIsLoading(false); // Prevent infinite loading spinner
      return;
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(merchantId)) {
      console.error(
        "[Merchant] fetchOrders: Invalid merchantId format:",
        merchantId,
      );
      setIsLoading(false);
      return;
    }

    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    try {
      const res = await fetchWithAuth(
        `/api/merchant/orders?merchant_id=${merchantId}&include_all_pending=true&limit=20`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        console.error(
          "[Merchant] Failed to fetch orders:",
          res.status,
          res.statusText,
          errorBody,
        );
        return;
      }
      const data = await res.json();
      // Store pagination info for "Load More"
      if (data.pagination) {
        nextCursorRef.current = data.pagination.next_cursor;
        setHasMoreOrders(data.pagination.has_more);
      }
      if (data.success && data.data) {
        const mappedOrders = data.data.map((o: DbOrder) =>
          mapDbOrderToUI(o, merchantId),
        );

        const fixedOrders = mappedOrders.map((order: Order) => {
          if (order.minimalStatus === "completed") {
            return { ...order, status: "completed" as const };
          }
          // Only fix status to 'escrow' if the merchant has CLAIMED the order (buyer_merchant_id set)
          const isClaimed = !!(
            order.buyerMerchantId || order.dbOrder?.buyer_merchant_id
          );
          const iAmClaimer =
            isClaimed &&
            (order.buyerMerchantId === merchantId ||
              order.dbOrder?.buyer_merchant_id === merchantId);
          if (
            iAmClaimer &&
            order.dbOrder?.status === "escrowed" &&
            getEffectiveStatus(order) === "pending"
          ) {
            return { ...order, status: "escrow" as const };
          }
          return order;
        });

        const validOrders = fixedOrders.filter((order: Order) => {
          const effectiveStatus = getEffectiveStatus(order);
          if (effectiveStatus === "pending" && order.expiresIn <= 0) {
            return false;
          }
          return true;
        });

        setOrders((prev: Order[]) => {
          return validOrders.map((incomingOrder: Order) => {
            const existing = prev.find((o: Order) => o.id === incomingOrder.id);
            if (!existing) return incomingOrder;
            if (existing.orderVersion && incomingOrder.orderVersion) {
              if (incomingOrder.orderVersion < existing.orderVersion) {
                return existing;
              }
            }
            if (incomingOrder.minimalStatus === "completed") {
              return incomingOrder;
            }
            return incomingOrder;
          });
        });
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      console.error("[Merchant] Error fetching orders:", error);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [merchantId]);

  // Load more orders (next page) — appends to existing list
  const loadMoreOrders = useCallback(async () => {
    if (!merchantId || !nextCursorRef.current || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetchWithAuth(
        `/api/merchant/orders?merchant_id=${merchantId}&include_all_pending=true&limit=10&cursor=${encodeURIComponent(nextCursorRef.current)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.pagination) {
        nextCursorRef.current = data.pagination.next_cursor;
        setHasMoreOrders(data.pagination.has_more);
      }
      if (data.success && data.data?.length > 0) {
        const mapped = data.data.map((o: any) => mapDbOrderToUI(o, merchantId));
        setOrders((prev: Order[]) => {
          const existingIds = new Set(prev.map((o: Order) => o.id));
          const newOrders = mapped.filter((o: Order) => !existingIds.has(o.id));
          return [...prev, ...newOrders];
        });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[Merchant] loadMoreOrders error:", err);
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [merchantId, isLoadingMore]);

  // Debounced fetch: coalesces multiple fetchOrders() calls within 150ms
  // If a fetch is already in-flight, schedules another fetch after it completes
  const needsRefetchAfterRef = useRef(false);
  const debouncedFetchOrders = useCallback(() => {
    if (fetchPendingRef.current) {
      // A fetch is in progress — schedule a follow-up instead of dropping
      needsRefetchAfterRef.current = true;
      return;
    }
    fetchPendingRef.current = true;
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => {
      fetchOrders().finally(() => {
        fetchPendingRef.current = false;
        fetchTimerRef.current = null;
        // If events arrived while fetching, do one more fetch
        if (needsRefetchAfterRef.current) {
          needsRefetchAfterRef.current = false;
          debouncedFetchOrders();
        }
      });
    }, 150);
  }, [fetchOrders]);

  const fetchInAppBalance = useCallback(async () => {
    if (!merchantId || !isMockMode) return;
    balanceAbortRef.current?.abort();
    const controller = new AbortController();
    balanceAbortRef.current = controller;
    try {
      const res = await fetchWithAuth(
        `/api/mock/balance?userId=${merchantId}&type=merchant`,
        { signal: controller.signal },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setInAppBalance(
            typeof data.balance === "string"
              ? parseFloat(data.balance)
              : data.balance,
          );
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Failed to fetch in-app balance:", err);
    }
  }, [merchantId, isMockMode]);

  const fetchMempoolOrders = useCallback(async () => {
    if (!merchantId) return;
    mempoolAbortRef.current?.abort();
    const controller = new AbortController();
    mempoolAbortRef.current = controller;
    try {
      const res = await fetchWithAuth(
        "/api/mempool?type=orders&corridor_id=USDT_AED&limit=50",
        { signal: controller.signal },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data?.orders) {
          const stamped = data.data.orders.map((o: any) => ({
            ...o,
            _receivedAt: Date.now(),
          }));
          setMempoolOrders(stamped);
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      console.error("Failed to fetch mempool orders:", error);
    }
  }, [merchantId]);

  const fetchResolvedDisputes = useCallback(async () => {
    if (!merchantId) return;
    disputesAbortRef.current?.abort();
    const controller = new AbortController();
    disputesAbortRef.current = controller;
    try {
      const res = await fetchWithAuth(
        `/api/disputes/resolved?actor_type=merchant&actor_id=${merchantId}`,
        { signal: controller.signal },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setResolvedDisputes(data.data);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Failed to fetch resolved disputes:", err);
    }
  }, [merchantId]);

  const fetchBigOrders = useCallback(async () => {
    if (!merchantId) return;
    bigOrdersAbortRef.current?.abort();
    const controller = new AbortController();
    bigOrdersAbortRef.current = controller;
    try {
      const res = await fetchWithAuth(
        `/api/merchant/big-orders?merchant_id=${merchantId}&limit=10`,
        { signal: controller.signal },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data?.orders) {
        const mappedOrders: BigOrderRequest[] = data.data.orders.map(
          (order: {
            id: string;
            user: { username: string };
            fiat_amount: number;
            fiat_currency: string;
            custom_notes?: string;
            premium_percent?: number;
            created_at: string;
          }) => ({
            id: order.id,
            user: order.user?.username || "Unknown",
            emoji: "🐳",
            amount: order.fiat_amount,
            currency: order.fiat_currency || "AED",
            message: order.custom_notes || "Large order available",
            timestamp: new Date(order.created_at),
            premium: order.premium_percent || 0,
          }),
        );
        if (mappedOrders.length > 0) {
          setBigOrders(mappedOrders);
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Failed to fetch big orders:", err);
    }
  }, [merchantId]);

  const fetchActiveOffers = useCallback(async () => {
    if (!merchantId) return;
    offersAbortRef.current?.abort();
    const controller = new AbortController();
    offersAbortRef.current = controller;
    try {
      const res = await fetchWithAuth(
        `/api/merchant/offers?merchant_id=${merchantId}`,
        { signal: controller.signal },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setActiveOffers(
          data.data.filter((o: { is_active: boolean }) => o.is_active),
        );
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Failed to fetch active offers:", err);
    }
  }, [merchantId]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/merchants/leaderboard");
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setLeaderboardData(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch leaderboard:", err);
    }
  }, []);

  // ─── Effective balance (mock vs on-chain) ───
  const effectiveBalance = isMockMode ? inAppBalance : solanaUsdtBalance;
  const refreshBalance = useCallback(() => {
    if (isMockMode) {
      fetchInAppBalance();
    } else {
      solanaRefreshBalances();
    }
  }, [isMockMode, fetchInAppBalance, solanaRefreshBalances]);

  // ─── Single-order refetch (authoritative, no version check) ───
  const refetchSingleOrder = useCallback(
    async (orderId: string) => {
      if (!merchantId) return;
      try {
        const res = await fetchWithAuth(
          `/api/orders/${orderId}?merchant_id=${merchantId}&_fresh=${Date.now()}`,
          {
            cache: "no-store",
            headers: { "Cache-Control": "no-cache" },
          },
        );
        if (!res.ok) {
          // 403 = not your order (broadcast event for another merchant's order) — silently ignore
          // 404 = order was expired/deleted between broadcast and refetch — silently ignore
          if (res.status !== 403 && res.status !== 404) {
            console.error("[Merchant] Failed to refetch order:", res.status);
          }
          return;
        }
        const data = await res.json();
        if (data.success && data.data) {
          let freshOrder = mapDbOrderToUI(data.data, merchantId);
          // Apply the same minimalStatus normalization as fetchOrders
          if (freshOrder.minimalStatus === "completed") {
            freshOrder = { ...freshOrder, status: "completed" as const };
          }
          setOrders((prev: Order[]) =>
            prev.map((o: Order) => {
              if (o.id !== orderId) return o;
              // Don't overwrite a completed/cancelled status with a non-terminal refetch
              if (
                (o.status === "completed" || o.status === "cancelled") &&
                freshOrder.status !== "completed" &&
                freshOrder.status !== "cancelled"
              ) {
                return o;
              }
              return freshOrder;
            }),
          );
        }
      } catch (error) {
        console.error("[Merchant] Error refetching single order:", error);
      }
    },
    [merchantId],
  );

  // ─── Post-mutation reconcile (optimistic + authoritative refetch) ───
  // WS/Pusher already syncs the full order list — only refetch the mutated order + balance
  const isPusherConnectedRef = useRef(isPusherConnected);
  isPusherConnectedRef.current = isPusherConnected;

  const afterMutationReconcile = useCallback(
    async (orderId: string, optimisticUpdate?: Partial<Order>) => {
      // Snapshot current version BEFORE optimistic update so we can detect WS delivery
      const currentVersion = useMerchantStore
        .getState()
        .orders.find((o: Order) => o.id === orderId)?.orderVersion;

      if (optimisticUpdate) {
        setOrders((prev: Order[]) =>
          prev.map((o: Order) => {
            if (o.id !== orderId) return o;
            const updated = { ...o, ...optimisticUpdate };
            // Immediately disable action buttons so they don't flash the old state.
            // The real primaryAction will arrive when the server refetch completes.
            if (optimisticUpdate.status) {
              (updated as any).primaryAction = null;
              (updated as any).secondaryAction = null;
            }
            return updated;
          }),
        );
      }

      // Wait 300ms then check if WS already delivered the update.
      // Reduced from 800ms — 300ms is enough for Pusher round-trip on a good connection.
      // If Pusher connected AND version advanced → skip redundant refetch.
      // Otherwise → refetch as fallback.
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          if (isPusherConnectedRef.current && currentVersion !== undefined) {
            const latestVersion = useMerchantStore
              .getState()
              .orders.find((o: Order) => o.id === orderId)?.orderVersion;
            if (latestVersion !== undefined && latestVersion > currentVersion) {
              resolve();
              return;
            }
          }
          refetchSingleOrder(orderId);
          resolve();
        }, 300),
      );
      // Full list refetch ensures enrichOrderResponse recomputes primaryAction
      // and refreshes chat last_message / unread_count fields.
      debouncedFetchOrders();
      refreshBalance();
    },
    [refetchSingleOrder, debouncedFetchOrders, refreshBalance],
  );

  const dismissBigOrder = useCallback((id: string) => {
    setBigOrders((prev) => prev.filter((o) => o.id !== id));
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // SINGLE POLLING ORCHESTRATOR (replaces 5 separate intervals)
  // ═══════════════════════════════════════════════════════════════════

  // Initial fetch — CRITICAL: orders + offers + balance (fires on login / merchantId change)
  useEffect(() => {
    if (!merchantId) return;
    fetchOrders();
    fetchActiveOffers();
    if (isMockMode) fetchInAppBalance();
  }, [
    merchantId,
    fetchOrders,
    fetchActiveOffers,
    isMockMode,
    fetchInAppBalance,
  ]);

  // Safety-net retry: on prod the initial fetchOrders() fires before the
  // session token has been restored (check_session is still in-flight), so
  // the request goes without an Authorization header and the server returns
  // an empty / 401 response. Orders state then stays [] until a route-level
  // remount refires the fetch (by which time the token is set). On dev,
  // React strict mode's double-invoke of effects masks this race.
  //
  // Fix: re-fire fetchOrders when (a) merchantId is set, AND (b) orders is
  // empty, AND (c) a sessionToken now exists. This deterministically
  // catches the moment the token arrives. A small 2s backstop also
  // re-fires for edge cases where the token path doesn't resolve cleanly.
  // Capped at 2 retries so legitimately empty accounts don't loop.
  const ordersEmpty = useMerchantStore((s) => s.orders.length === 0);
  const sessionTokenPresent = useMerchantStore((s) => !!s.sessionToken);
  const ordersRetryRef = useRef(0);
  useEffect(() => {
    if (!merchantId) {
      ordersRetryRef.current = 0;
      return;
    }
    if (!ordersEmpty) {
      ordersRetryRef.current = 0;
      return;
    }
    if (ordersRetryRef.current >= 2) return;

    // Fire immediately when the session token arrives (token-gated path).
    // Otherwise fall back to a 2s timer so the retry still runs even if the
    // token flow doesn't produce a observable change (e.g. already set).
    const delay = sessionTokenPresent ? 50 : 2000;
    const timer = setTimeout(() => {
      ordersRetryRef.current += 1;
      fetchOrders();
    }, delay);
    return () => clearTimeout(timer);
  }, [merchantId, ordersEmpty, sessionTokenPresent, fetchOrders]);

  // Initial fetch — SECONDARY: leaderboard, disputes, big orders, mempool (deferred 2s)
  useEffect(() => {
    if (!merchantId) return;
    const timer = setTimeout(() => {
      fetchLeaderboard();
      if (isMempoolVisibleRef.current) fetchMempoolOrders();
      fetchResolvedDisputes();
      fetchBigOrders();
    }, 2000);
    return () => clearTimeout(timer);
  }, [
    merchantId,
    fetchLeaderboard,
    fetchMempoolOrders,
    fetchResolvedDisputes,
    fetchBigOrders,
  ]);

  // Unified poll: skip order polling when Pusher handles it, keep mempool/expiry
  useEffect(() => {
    if (!merchantId) return;
    let tickCount = 0;

    if (isPusherConnected) {
      // Pusher handles order updates — only poll mempool (when visible) + periodic balance
      const tick = () => {
        tickCount++;
        if (isMempoolVisibleRef.current) fetchMempoolOrders();
        lastSyncRef.current = Date.now();
        // Every 3rd tick (~90s): balance
        if (tickCount % 3 === 0) {
          if (isMockMode) fetchInAppBalance();
        }
      };
      const interval = setInterval(tick, 30000);
      return () => clearInterval(interval);
    } else {
      // No Pusher — poll everything at 5s
      const tick = () => {
        tickCount++;
        debouncedFetchOrders();
        if (isMempoolVisibleRef.current) fetchMempoolOrders();
        lastSyncRef.current = Date.now();
        if (tickCount % 3 === 0) {
          if (isMockMode) fetchInAppBalance();
        }
      };
      const interval = setInterval(tick, 15000); // was 5s — reduced Redis load by 66%
      return () => clearInterval(interval);
    }
    // isMempoolVisible removed — uses ref to avoid restarting polling interval on toggle
  }, [
    merchantId,
    isPusherConnected,
    debouncedFetchOrders,
    fetchMempoolOrders,
    isMockMode,
    fetchInAppBalance,
  ]);

  // Pusher reconnect — single sync
  useEffect(() => {
    if (isPusherConnected && !prevPusherConnected.current) {
      debouncedFetchOrders();
      lastSyncRef.current = Date.now();
    }
    prevPusherConnected.current = isPusherConnected;
  }, [isPusherConnected, debouncedFetchOrders]);

  // Page visibility — sync on tab return
  useEffect(() => {
    if (!merchantId) return;
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastSyncRef.current > 5000
      ) {
        debouncedFetchOrders();
        lastSyncRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [merchantId, debouncedFetchOrders]);

  // Expiry countdown — tick every 10s (UI shows "X min")
  useEffect(() => {
    const interval = setInterval(() => {
      setOrders((prev: Order[]) => {
        let hasChanges = false;
        const updated = prev.map((order: Order) => {
          if (order.status === "completed" || order.status === "cancelled")
            return order;
          if (order.expiresIn <= 0) return order;
          hasChanges = true;
          return { ...order, expiresIn: Math.max(0, order.expiresIn - 10) };
        });
        return hasChanges ? updated : prev;
      });
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return {
    // State
    activeOffers,
    leaderboardData,
    inAppBalance,
    bigOrders,
    mempoolOrders,
    resolvedDisputes,
    effectiveBalance,

    // Mempool visibility
    isMempoolVisible,
    setIsMempoolVisible,

    // State setters (for external mutation by realtime/other hooks)
    setActiveOffers,
    setBigOrders,
    setMempoolOrders,
    setResolvedDisputes,

    // Fetch actions
    fetchOrders,
    debouncedFetchOrders,
    fetchMempoolOrders,
    fetchActiveOffers,
    fetchInAppBalance,
    refreshBalance,
    refetchSingleOrder,
    afterMutationReconcile,
    dismissBigOrder,

    // Pagination
    loadMoreOrders,
    hasMoreOrders,
    isLoadingMore,
  };
}
