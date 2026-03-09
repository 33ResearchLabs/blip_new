"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { DbOrder, Order, LeaderboardEntry, BigOrderRequest } from "@/types/merchant";
import { getEffectiveStatus, mapDbOrderToUI } from "@/lib/orders/mappers";

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
  const orders = useMerchantStore(s => s.orders);
  const setOrders = useMerchantStore(s => s.setOrders);
  const merchantId = useMerchantStore(s => s.merchantId);
  const setIsLoading = useMerchantStore(s => s.setIsLoading);

  // ─── Local state ───
  const [activeOffers, setActiveOffers] = useState<{ id: string; type: string; available_amount: number; is_active: boolean }[]>([]);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [inAppBalance, setInAppBalance] = useState<number | null>(isMockMode ? 10000 : null);
  const [bigOrders, setBigOrders] = useState<BigOrderRequest[]>([]);
  const [mempoolOrders, setMempoolOrders] = useState<any[]>([]);
  const [resolvedDisputes, setResolvedDisputes] = useState<ResolvedDispute[]>([]);

  // ─── Abort controllers ───
  const fetchAbortRef = useRef<AbortController | null>(null);
  const balanceAbortRef = useRef<AbortController | null>(null);
  const mempoolAbortRef = useRef<AbortController | null>(null);

  // ─── Debounce refs ───
  const fetchPendingRef = useRef(false);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Polling refs ───
  const prevPusherConnected = useRef(isPusherConnected);
  const lastSyncRef = useRef<number>(Date.now());

  // ═══════════════════════════════════════════════════════════════════
  // FETCH FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════

  const fetchOrders = useCallback(async () => {
    if (!merchantId) return;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(merchantId)) {
      console.error('[Merchant] fetchOrders: Invalid merchantId format:', merchantId);
      return;
    }

    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    try {
      const res = await fetch(`/api/merchant/orders?merchant_id=${merchantId}&include_all_pending=true&_t=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        console.error('[Merchant] Failed to fetch orders:', res.status, res.statusText, errorBody);
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        const mappedOrders = data.data.map((o: DbOrder) => mapDbOrderToUI(o, merchantId));

        const fixedOrders = mappedOrders.map((order: Order) => {
          if (order.minimalStatus === 'completed') {
            return { ...order, status: 'completed' as const };
          }
          if (order.isMyOrder && order.dbOrder?.status === 'escrowed' && getEffectiveStatus(order) === 'pending') {
            return { ...order, status: 'escrow' as const };
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
            if (incomingOrder.minimalStatus === 'completed') {
              return incomingOrder;
            }
            return incomingOrder;
          });
        });
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error("[Merchant] Error fetching orders:", error);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [merchantId]);

  // Debounced fetch: coalesces multiple fetchOrders() calls within 150ms
  const debouncedFetchOrders = useCallback(() => {
    if (fetchPendingRef.current) return;
    fetchPendingRef.current = true;
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => {
      fetchOrders().finally(() => {
        fetchPendingRef.current = false;
        fetchTimerRef.current = null;
      });
    }, 150);
  }, [fetchOrders]);

  const fetchInAppBalance = useCallback(async () => {
    if (!merchantId || !isMockMode) return;
    balanceAbortRef.current?.abort();
    const controller = new AbortController();
    balanceAbortRef.current = controller;
    try {
      const res = await fetch(`/api/mock/balance?userId=${merchantId}&type=merchant`, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setInAppBalance(typeof data.balance === 'string' ? parseFloat(data.balance) : data.balance);
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('Failed to fetch in-app balance:', err);
    }
  }, [merchantId, isMockMode]);

  const fetchMempoolOrders = useCallback(async () => {
    if (!merchantId) return;
    mempoolAbortRef.current?.abort();
    const controller = new AbortController();
    mempoolAbortRef.current = controller;
    try {
      const res = await fetch('/api/mempool?type=orders&corridor_id=USDT_AED&limit=50', { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data?.orders) {
          const stamped = data.data.orders.map((o: any) => ({ ...o, _receivedAt: Date.now() }));
          setMempoolOrders(stamped);
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error('Failed to fetch mempool orders:', error);
    }
  }, [merchantId]);

  const fetchResolvedDisputes = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetch(`/api/disputes/resolved?actor_type=merchant&actor_id=${merchantId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setResolvedDisputes(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch resolved disputes:', err);
    }
  }, [merchantId]);

  const fetchBigOrders = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetch(`/api/merchant/orders?merchant_id=${merchantId}&view=big_orders&limit=10`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data?.orders) {
        const mappedOrders: BigOrderRequest[] = data.data.orders.map((order: {
          id: string;
          user: { username: string };
          fiat_amount: number;
          fiat_currency: string;
          custom_notes?: string;
          premium_percent?: number;
          created_at: string;
        }) => ({
          id: order.id,
          user: order.user?.username || 'Unknown',
          emoji: '🐳',
          amount: order.fiat_amount,
          currency: order.fiat_currency || 'AED',
          message: order.custom_notes || 'Large order available',
          timestamp: new Date(order.created_at),
          premium: order.premium_percent || 0,
        }));
        if (mappedOrders.length > 0) {
          setBigOrders(mappedOrders);
        }
      }
    } catch (err) {
      console.error('Failed to fetch big orders:', err);
    }
  }, [merchantId]);

  const fetchActiveOffers = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetch(`/api/merchant/offers?merchant_id=${merchantId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setActiveOffers(data.data.filter((o: { is_active: boolean }) => o.is_active));
      }
    } catch (err) {
      console.error('Failed to fetch active offers:', err);
    }
  }, [merchantId]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/merchants/leaderboard');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setLeaderboardData(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
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
  const refetchSingleOrder = useCallback(async (orderId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}?actor_type=merchant&actor_id=${merchantId}&_t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (!res.ok) {
        console.error('[Merchant] Failed to refetch order:', res.status);
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        const freshOrder = mapDbOrderToUI(data.data, merchantId);
        setOrders((prev: Order[]) => prev.map((o: Order) => o.id === orderId ? freshOrder : o));
      }
    } catch (error) {
      console.error('[Merchant] Error refetching single order:', error);
    }
  }, [merchantId]);

  // ─── Post-mutation reconcile (optimistic + authoritative refetch) ───
  const afterMutationReconcile = useCallback(async (
    orderId: string,
    optimisticUpdate?: Partial<Order>,
  ) => {
    if (optimisticUpdate) {
      setOrders((prev: Order[]) => prev.map((o: Order) =>
        o.id === orderId ? { ...o, ...optimisticUpdate } : o
      ));
    }
    setTimeout(() => refetchSingleOrder(orderId), 300);
    await fetchOrders();
    refreshBalance();
  }, [refetchSingleOrder, fetchOrders, refreshBalance]);

  const dismissBigOrder = useCallback((id: string) => {
    setBigOrders(prev => prev.filter(o => o.id !== id));
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════════

  // Balance polling (mock mode)
  useEffect(() => {
    if (isMockMode && merchantId) {
      fetchInAppBalance();
      const interval = setInterval(fetchInAppBalance, 30000);
      return () => clearInterval(interval);
    }
  }, [isMockMode, merchantId, fetchInAppBalance]);

  // Initial fetch on login
  useEffect(() => {
    if (!merchantId) return;
    fetchOrders();
    fetchMempoolOrders();
    fetchResolvedDisputes();
    fetchBigOrders();
    fetchActiveOffers();
    fetchLeaderboard();
  }, [merchantId, fetchOrders, fetchMempoolOrders, fetchResolvedDisputes, fetchBigOrders, fetchActiveOffers, fetchLeaderboard]);

  // Tier 2: Smart polling
  useEffect(() => {
    if (!merchantId) return;
    const pollInterval = isPusherConnected ? 30000 : 5000;
    const interval = setInterval(() => {
      debouncedFetchOrders();
      fetchMempoolOrders();
      lastSyncRef.current = Date.now();
    }, pollInterval);
    return () => clearInterval(interval);
  }, [merchantId, isPusherConnected, debouncedFetchOrders, fetchMempoolOrders]);

  // Tier 3a: Pusher reconnect
  useEffect(() => {
    if (isPusherConnected && !prevPusherConnected.current) {
      debouncedFetchOrders();
      fetchMempoolOrders();
      lastSyncRef.current = Date.now();
    }
    prevPusherConnected.current = isPusherConnected;
  }, [isPusherConnected, debouncedFetchOrders, fetchMempoolOrders]);

  // Tier 3b: Page visibility
  useEffect(() => {
    if (!merchantId) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const timeSinceSync = Date.now() - lastSyncRef.current;
        if (timeSinceSync > 3000) {
          debouncedFetchOrders();
          lastSyncRef.current = Date.now();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [merchantId, debouncedFetchOrders]);

  // Auto-expire orders via API
  useEffect(() => {
    if (!merchantId) return;
    const expireOrders = async () => {
      try {
        await fetch('/api/orders/expire', { method: 'POST' });
      } catch (error) {
        console.error('[Merchant] Failed to expire orders:', error);
      }
    };
    expireOrders();
    const interval = setInterval(expireOrders, 30000);
    return () => clearInterval(interval);
  }, [merchantId]);

  // Expiry countdown timer — tick every 10s (UI shows "X min", not seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      setOrders((prev: Order[]) => {
        let hasChanges = false;
        const updated = prev.map((order: Order) => {
          if (order.status === "completed" || order.status === "cancelled") return order;
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
  };
}
