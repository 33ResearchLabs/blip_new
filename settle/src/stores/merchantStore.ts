import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

// ─── Payment method ─────────────────────────────────────────────────
// Shape mirrors what /api/merchant/[id]/payment-methods returns and what
// TradeFormModal renders. Held in the store so it can be preloaded once at
// dashboard load and reused by the trade modal (no fetch-on-open flash).
export interface MerchantPaymentMethod {
  id: string;
  type: 'bank' | 'cash' | 'crypto' | 'card' | 'mobile' | 'upi';
  name: string;
  details?: string;
  is_default?: boolean;
}

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

  // ─── Payment methods (preloaded at dashboard load) ───
  // Single source of truth so the trade modal opens already populated
  // instead of fetching on open. `paymentMethodsLoaded` lets consumers tell
  // "empty because not fetched yet" apart from "genuinely no methods".
  paymentMethods: MerchantPaymentMethod[];
  paymentMethodsLoaded: boolean;

  // ─── Access token (in-memory ONLY) ───────────────────
  // Held purely in the Zustand store so other hooks (useOrderFetching,
  // useMerchantConversations) can observe "is the user logged in yet?" the
  // moment a login route returns. NEVER persisted: the httpOnly cookie
  // `blip_access_token` is the durable auth artifact; on reload, a fresh
  // /api/auth/me call (or refresh) re-establishes UI state.
  sessionToken: string | null;

  // ─── PendingOrdersPanel filter/sort state ──────────
  searchQuery: string;
  orderViewFilter: OrderViewFilter;
  pendingFilter: PendingFilter;
  pendingSortBy: PendingSortBy;
  orderFilters: OrderFilters;
  showOrderFilters: boolean;
  soundEnabled: boolean;

  // ─── Dashboard edit mode (Phase 2, migration 146) ────
  // When true, widgets show drag handles + hide buttons and become
  // sortable. Always defaults to false so a fresh load is read-only.
  // Not persisted — merchants should opt-in each session.
  isEditingLayout: boolean;

  // ─── Actions ────────────────────────────────────────
  /** Accepts direct value OR callback (prev => next) — drop-in replacement for useState setter */
  setOrders: (ordersOrFn: any[] | ((prev: any[]) => any[])) => void;
  /** Merge-update orders: only applies patches that are newer (version-aware) */
  mergeOrders: (incoming: any[]) => void;

  setSessionToken: (token: string | null) => void;
  setMerchantId: (id: string | null) => void;
  /** Accepts direct value OR callback (prev => next) */
  setMerchantInfo: (infoOrFn: any | null | ((prev: any | null) => any | null)) => void;
  setIsLoggedIn: (v: boolean) => void;
  setIsLoading: (v: boolean) => void;

  // ─── Payment method actions ────────────────────────
  setPaymentMethods: (m: MerchantPaymentMethod[]) => void;
  /** Fetch + cache the merchant's payment methods. Safe to call repeatedly
   *  (preload on dashboard load, background refresh on modal/dropdown open).
   *  Never throws — failures leave the existing cache untouched. */
  fetchPaymentMethods: (merchantId: string | null) => Promise<void>;

  // ─── Filter/sort setters ───────────────────────────
  setSearchQuery: (q: string) => void;
  setOrderViewFilter: (f: OrderViewFilter) => void;
  setPendingFilter: (f: PendingFilter) => void;
  setPendingSortBy: (s: PendingSortBy) => void;
  setOrderFilters: (fOrFn: OrderFilters | ((prev: OrderFilters) => OrderFilters)) => void;
  setShowOrderFilters: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
  setIsEditingLayout: (v: boolean) => void;
}

export const useMerchantStore = create<MerchantStoreState>()(
  subscribeWithSelector((set, get) => ({
    // ─── Initial state ──────────────────────────────────
    orders: [],
    merchantId: null,
    merchantInfo: null,
    isLoggedIn: false,
    isLoading: true,
    sessionToken: null,
    paymentMethods: [],
    paymentMethodsLoaded: false,

    // ─── Filter/sort initial state ─────────────────────
    searchQuery: '',
    orderViewFilter: 'new',
    pendingFilter: 'all',
    pendingSortBy: 'time',
    orderFilters: { type: 'all', amount: 'all', method: 'all', secured: 'all' },
    showOrderFilters: false,
    soundEnabled: true,
    isEditingLayout: false,

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

    setSessionToken: (token) => {
      // In-memory only. The token IS the access token returned by login
      // routes — but the durable copy lives in the httpOnly `blip_access_token`
      // cookie set by those same routes. We keep an in-memory mirror so
      // UI state (useOrderFetching's logged-in gate, etc.) can react
      // synchronously, and we do NOT mirror it to sessionStorage where it
      // would be readable by any same-origin script (XSS exfil target).
      set({ sessionToken: token });
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

    // ─── Payment method actions ────────────────────────
    setPaymentMethods: (m) => set({ paymentMethods: m, paymentMethodsLoaded: true }),
    fetchPaymentMethods: async (merchantId) => {
      if (!merchantId) return;
      try {
        const res = await fetchWithAuth(`/api/merchant/${merchantId}/payment-methods`);
        if (!res.ok) return;
        const json = await res.json();
        if (json?.success && Array.isArray(json.data)) {
          const rows = json.data as Array<{
            id: string | number;
            type: MerchantPaymentMethod['type'];
            name?: string | null;
            details?: string | null;
            is_default?: boolean;
          }>;
          set({
            paymentMethods: rows.map((m) => ({
              id: String(m.id),
              type: m.type,
              name: String(m.name ?? ''),
              details: m.details != null ? String(m.details) : undefined,
              is_default: !!m.is_default,
            })),
            paymentMethodsLoaded: true,
          });
        }
      } catch {
        // Swallow — keep whatever is already cached; consumers fall back to
        // their own fetch / empty state. Never breaks the dashboard.
      }
    },

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
    setIsEditingLayout: (v) => set({ isEditingLayout: v }),
  }))
);
