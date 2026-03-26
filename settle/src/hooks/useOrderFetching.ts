"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { DbOrder, Order, LeaderboardEntry, BigOrderRequest } from "@/types/merchant";
import { getEffectiveStatus, mapDbOrderToUI } from "@/lib/orders/mappers";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

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
      const res = await fetchWithAuth(`/api/merchant/orders?merchant_id=${merchantId}&include_all_pending=true&_t=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
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
          // Only fix status to 'escrow' if the merchant has CLAIMED the order (buyer_merchant_id set)
          const isClaimed = !!(order.buyerMerchantId || order.dbOrder?.buyer_merchant_id);
          const iAmClaimer = isClaimed && (order.buyerMerchantId === merchantId || order.dbOrder?.buyer_merchant_id === merchantId);
          if (iAmClaimer && order.dbOrder?.status === 'escrowed' && getEffectiveStatus(order) === 'pending') {
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
      const res = await fetchWithAuth(`/api/mock/balance?userId=${merchantId}&type=merchant`, { signal: controller.signal });
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
      const res = await fetchWithAuth('/api/mempool?type=orders&corridor_id=USDT_AED&limit=50', { signal: controller.signal });
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
      const res = await fetchWithAuth(`/api/disputes/resolved?actor_type=merchant&actor_id=${merchantId}`);
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
      const res = await fetchWithAuth(`/api/merchant/big-orders?merchant_id=${merchantId}&limit=10`);
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
      const res = await fetchWithAuth(`/api/merchant/offers?merchant_id=${merchantId}`);
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
      const res = await fetchWithAuth('/api/merchants/leaderboard');
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
    if (!merchantId) return;
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}?merchant_id=${merchantId}&_t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (!res.ok) {
        console.error('[Merchant] Failed to refetch order:', res.status);
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        let freshOrder = mapDbOrderToUI(data.data, merchantId);
        // Apply the same minimalStatus normalization as fetchOrders
        if (freshOrder.minimalStatus === 'completed') {
          freshOrder = { ...freshOrder, status: 'completed' as const };
        }
        setOrders((prev: Order[]) => prev.map((o: Order) => {
          if (o.id !== orderId) return o;
          // Don't overwrite a completed/cancelled optimistic status with a stale refetch
          if ((o.status === 'completed' || o.status === 'cancelled') && freshOrder.status !== 'completed' && freshOrder.status !== 'cancelled') {
            return o;
          }
          return freshOrder;
        }));
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
    // Parallel: refetch single order (delayed for DB consistency), full list, and balance
    // Use 800ms delay to give core-api time to commit (300ms was causing stale reads)
    await Promise.all([
      new Promise<void>(resolve => setTimeout(() => { refetchSingleOrder(orderId); resolve(); }, 800)),
      fetchOrders(),
    ]);
    refreshBalance();
  }, [refetchSingleOrder, fetchOrders, refreshBalance]);

  const dismissBigOrder = useCallback((id: string) => {
    setBigOrders(prev => prev.filter(o => o.id !== id));
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // SINGLE POLLING ORCHESTRATOR (replaces 5 separate intervals)
  // ═══════════════════════════════════════════════════════════════════

  // Initial fetch on login
  useEffect(() => {
    if (!merchantId) return;
    fetchOrders();
    fetchMempoolOrders();
    fetchResolvedDisputes();
    fetchBigOrders();
    fetchActiveOffers();
    fetchLeaderboard();
    if (isMockMode) fetchInAppBalance();
  }, [merchantId, fetchOrders, fetchMempoolOrders, fetchResolvedDisputes, fetchBigOrders, fetchActiveOffers, fetchLeaderboard, isMockMode, fetchInAppBalance]);

  // Unified poll: skip order polling when Pusher handles it, keep mempool/expiry
  useEffect(() => {
    if (!merchantId) return;
    let tickCount = 0;

    if (isPusherConnected) {
      // Pusher handles order updates — only poll mempool + periodic expiry/balance
      const tick = () => {
        tickCount++;
        fetchMempoolOrders();
        lastSyncRef.current = Date.now();
        // Every 3rd tick (~90s): expire + balance
        if (tickCount % 3 === 0) {
          fetchWithAuth('/api/orders/expire', { method: 'POST' }).catch(() => {});
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
        fetchMempoolOrders();
        lastSyncRef.current = Date.now();
        if (tickCount % 3 === 0) {
          fetchWithAuth('/api/orders/expire', { method: 'POST' }).catch(() => {});
          if (isMockMode) fetchInAppBalance();
        }
      };
      const interval = setInterval(tick, 5000);
      return () => clearInterval(interval);
    }
  }, [merchantId, isPusherConnected, debouncedFetchOrders, fetchMempoolOrders, isMockMode, fetchInAppBalance]);

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
      if (document.visibilityState === 'visible' && Date.now() - lastSyncRef.current > 5000) {
        debouncedFetchOrders();
        lastSyncRef.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [merchantId, debouncedFetchOrders]);

  // Expiry countdown — tick every 10s (UI shows "X min")
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
