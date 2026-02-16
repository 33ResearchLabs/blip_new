import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// ─── Filter/sort types ──────────────────────────────────────────────
export type PendingFilter = 'all' | 'mineable' | 'premium' | 'large' | 'expiring';
export type PendingSortBy = 'time' | 'premium' | 'amount' | 'rating';
export type OrderViewFilter = 'new' | 'all';
export interface OrderFilters {
  type: 'all' | 'buy' | 'sell';
  amount: 'all' | 'small' | 'medium' | 'large';
  method: 'all' | 'bank' | 'cash';
  secured: 'all' | 'yes' | 'no';
}

export interface MerchantStoreState {
  // ─── Core data ──────────────────────────────────────
  orders: any[];
  merchantId: string | null;
  merchantInfo: any | null;
  isLoggedIn: boolean;
  isLoading: boolean;

  // ─── PendingOrdersPanel filter/sort state ──────────
  searchQuery: string;
  orderViewFilter: OrderViewFilter;
  pendingFilter: PendingFilter;
  pendingSortBy: PendingSortBy;
  orderFilters: OrderFilters;
  showOrderFilters: boolean;
  soundEnabled: boolean;

  // ─── Actions ────────────────────────────────────────
  /** Accepts direct value OR callback (prev => next) — drop-in replacement for useState setter */
  setOrders: (ordersOrFn: any[] | ((prev: any[]) => any[])) => void;
  /** Merge-update orders: only applies patches that are newer (version-aware) */
  mergeOrders: (incoming: any[]) => void;

  setMerchantId: (id: string | null) => void;
  /** Accepts direct value OR callback (prev => next) */
  setMerchantInfo: (infoOrFn: any | null | ((prev: any | null) => any | null)) => void;
  setIsLoggedIn: (v: boolean) => void;
  setIsLoading: (v: boolean) => void;

  // ─── Filter/sort setters ───────────────────────────
  setSearchQuery: (q: string) => void;
  setOrderViewFilter: (f: OrderViewFilter) => void;
  setPendingFilter: (f: PendingFilter) => void;
  setPendingSortBy: (s: PendingSortBy) => void;
  setOrderFilters: (fOrFn: OrderFilters | ((prev: OrderFilters) => OrderFilters)) => void;
  setShowOrderFilters: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
}

export const useMerchantStore = create<MerchantStoreState>()(
  subscribeWithSelector((set, get) => ({
    // ─── Initial state ──────────────────────────────────
    orders: [],
    merchantId: null,
    merchantInfo: null,
    isLoggedIn: false,
    isLoading: true,

    // ─── Filter/sort initial state ─────────────────────
    searchQuery: '',
    orderViewFilter: 'new',
    pendingFilter: 'all',
    pendingSortBy: 'time',
    orderFilters: { type: 'all', amount: 'all', method: 'all', secured: 'all' },
    showOrderFilters: false,
    soundEnabled: true,

    // ─── Actions ────────────────────────────────────────

    setOrders: (ordersOrFn) => {
      if (typeof ordersOrFn === 'function') {
        set((state) => ({ orders: ordersOrFn(state.orders) }));
      } else {
        set({ orders: ordersOrFn });
      }
    },

    mergeOrders: (incoming) => {
      set((state) => {
        const merged = incoming.map((inOrder: any) => {
          const existing = state.orders.find((o: any) => o.id === inOrder.id);
          if (!existing) return inOrder;

          // Version check: keep whichever is newer
          if (existing.orderVersion && inOrder.orderVersion) {
            if (inOrder.orderVersion < existing.orderVersion) {
              return existing;
            }
          }
          // Completed always wins
          if (inOrder.minimalStatus === 'completed') return inOrder;
          return inOrder;
        });
        return { orders: merged };
      });
    },

    setMerchantId: (id) => set({ merchantId: id }),
    setMerchantInfo: (infoOrFn) => {
      if (typeof infoOrFn === 'function') {
        set((state) => ({ merchantInfo: infoOrFn(state.merchantInfo) }));
      } else {
        set({ merchantInfo: infoOrFn });
      }
    },
    setIsLoggedIn: (v) => set({ isLoggedIn: v }),
    setIsLoading: (v) => set({ isLoading: v }),

    // ─── Filter/sort setters ───────────────────────────
    setSearchQuery: (q) => set({ searchQuery: q }),
    setOrderViewFilter: (f) => set({ orderViewFilter: f }),
    setPendingFilter: (f) => set({ pendingFilter: f }),
    setPendingSortBy: (s) => set({ pendingSortBy: s }),
    setOrderFilters: (fOrFn) => {
      if (typeof fOrFn === 'function') {
        set((state) => ({ orderFilters: fOrFn(state.orderFilters) }));
      } else {
        set({ orderFilters: fOrFn });
      }
    },
    setShowOrderFilters: (v) => set({ showOrderFilters: v }),
    setSoundEnabled: (v) => set({ soundEnabled: v }),
  }))
);
