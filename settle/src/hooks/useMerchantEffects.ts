"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import { usePusher } from "@/context/PusherContext";
import { useWebSocketChatContextOptional } from "@/context/WebSocketChatContext";
import type { Order, DbOrder } from "@/types/merchant";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { signLoginNonce } from '@/lib/auth/walletAuth';
import {
  flashTabTitle,
  restoreTabTitle,
  showOSNotification,
  requestNotificationPermission,
  notificationPermission,
} from '@/lib/notifications/attention';
import { getNotifPrefs } from '@/hooks/useNotifPrefs';
import { useOnboarding } from '@/contexts/OnboardingContext';

interface UseMerchantEffectsParams {
  isMockMode: boolean;
  solanaWallet: any;
  merchantInfo: any;
  isLoggedIn: boolean;
  orders: Order[];
  fetchOrders: () => Promise<void>;
  debouncedFetchOrders: () => void;
  refetchSingleOrder: (orderId: string) => Promise<void>;
  refreshBalance: () => void;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  addNotification: (type: any, message: string, orderId?: string) => void;
  toast: any;
  chatWindows: any[];
  activeChatId: string | null;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  fetchOrderConversations: () => Promise<void>;
  autoRefundEscrow: (order: Order) => Promise<void>;
}

export function useMerchantEffects({
  isMockMode,
  solanaWallet,
  merchantInfo,
  isLoggedIn,
  orders,
  fetchOrders,
  debouncedFetchOrders,
  refetchSingleOrder,
  refreshBalance,
  playSound,
  addNotification,
  toast,
  chatWindows,
  activeChatId,
  messagesEndRef,
  fetchOrderConversations,
  autoRefundEscrow,
}: UseMerchantEffectsParams) {
  const merchantId = useMerchantStore(s => s.merchantId);
  const setOrders = useMerchantStore(s => s.setOrders);
  const setMerchantInfo = useMerchantStore(s => s.setMerchantInfo);
  const { setActor } = usePusher();
  const wsContext = useWebSocketChatContextOptional();
  const { refresh: refreshOnboarding } = useOnboarding();

  // Held in a ref so the wallet-link effect can fire-and-forget an onboarding
  // refresh without `refresh` becoming an effect dependency — keeping that
  // effect's re-run conditions (and the wallet-signature prompt guard)
  // byte-for-byte unchanged. zero regression.
  const refreshOnboardingRef = useRef(refreshOnboarding);
  useEffect(() => {
    refreshOnboardingRef.current = refreshOnboarding;
  }, [refreshOnboarding]);

  const fetchOrderConversationsRef = useRef<(() => Promise<void>) | undefined>(undefined);

  useEffect(() => {
    fetchOrderConversationsRef.current = fetchOrderConversations;
  }, [fetchOrderConversations]);

  // Fetch conversations when logged in
  useEffect(() => {
    if (merchantId && isLoggedIn) {
      fetchOrderConversations();
    }
  }, [merchantId, isLoggedIn, fetchOrderConversations]);

  // Set Pusher actor when merchant ID is available
  useEffect(() => {
    if (merchantId) {
      setActor('merchant', merchantId);
    }
  }, [merchantId, setActor]);

  // Debounced fetch conversations
  const convFetchPendingRef = useRef(false);
  const convFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetchConversations = useCallback(() => {
    if (convFetchPendingRef.current) return;
    convFetchPendingRef.current = true;
    if (convFetchTimerRef.current) clearTimeout(convFetchTimerRef.current);
    convFetchTimerRef.current = setTimeout(() => {
      fetchOrderConversations().finally(() => {
        convFetchPendingRef.current = false;
        convFetchTimerRef.current = null;
      });
    }, 150);
  }, [fetchOrderConversations]);

  // WebSocket order event handler
  useEffect(() => {
    if (!wsContext) return;

    const unsubscribe = wsContext.onOrderEvent((event: any) => {
      const data = event.data as { orderId?: string; status?: string };

      if (event.type === 'order:status-updated') {
        const orderId = data.orderId;
        const newStatus = data.status;
        if (!orderId || !newStatus) return;

        setOrders((prev: Order[]) => {
          const order = prev.find(o => o.id === orderId);
          if (!order) return prev;
          let uiStatus: Order['status'] | null = null;
          switch (newStatus) {
            case 'cancelled': case 'expired': uiStatus = 'cancelled'; break;
            case 'accepted': uiStatus = order.escrowTxHash ? 'escrow' : 'active'; break;
            case 'escrowed': case 'payment_sent': case 'payment_confirmed': case 'releasing': uiStatus = 'escrow'; break;
            case 'completed': uiStatus = 'completed'; break;
            case 'disputed': uiStatus = 'disputed'; break;
          }
          if (!uiStatus) return prev;
          return prev.map(o => o.id === orderId ? { ...o, status: uiStatus as Order['status'], minimalStatus: newStatus } : o);
        });

        // Fast path + full refetch to ensure UI state is correct
        refetchSingleOrder(orderId);
        debouncedFetchOrders();
        debouncedFetchConversations();

        // Gate order-event sounds on the merchant's notification pref.
        // Default (no saved pref) is true → unchanged behavior.
        // refreshBalance() is NOT gated — that's data freshness, not an alert.
        const { orderAlerts } = getNotifPrefs();
        if (newStatus === 'payment_sent') { if (orderAlerts) playSound('notification'); }
        else if (newStatus === 'completed') { if (orderAlerts) playSound('order_complete'); refreshBalance(); }
      } else if (event.type === 'order:cancelled') {
        if (data.orderId) refetchSingleOrder(data.orderId);
        debouncedFetchOrders();
        if (getNotifPrefs().orderAlerts) playSound('error');
      } else if (event.type === 'order:created') {
        debouncedFetchOrders();
        if (getNotifPrefs().orderAlerts) playSound('new_order');
      }
    });

    return unsubscribe;
  }, [wsContext, debouncedFetchOrders, refetchSingleOrder, debouncedFetchConversations, playSound, refreshBalance]);

  // Keyboard shortcuts for dashboard
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputField = ['INPUT', 'TEXTAREA'].includes(target.tagName);

      if (e.key === '/' && !isInputField) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="Search"]');
        searchInput?.focus();
      }

      if ((e.key === 'r' || e.key === 'R') && !isInputField && !(e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        fetchOrders();
      }
    };

    if (isLoggedIn) {
      window.addEventListener('keydown', handleKeyPress);
      return () => window.removeEventListener('keydown', handleKeyPress);
    }
  }, [isLoggedIn, fetchOrders]);

  // Update merchant wallet address when connected.
  //
  // The PATCH /api/auth/merchant endpoint requires a wallet-ownership proof
  // (signature + message + nonce) — anyone with a merchant token could
  // otherwise claim any wallet address. We fetch a server nonce, ask the
  // connected wallet to sign the canonical message, and send everything.
  //
  // The guarded ref keeps us from re-prompting the user to sign on every
  // re-render that mentions the same wallet — only one signing attempt
  // per (merchantId, walletAddress) pair per mount.
  const walletLinkAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    const updateMerchantWallet = async () => {
      // Mock mode produces a FAKE wallet signature that the server (correctly)
      // rejects with 401 "Invalid wallet signature". Skip the auto-link entirely
      // on mock/devnet so it doesn't error every render and churn fetchWithAuth's
      // token refresh (which can stall the balance/corridor fetch behind it).
      // No-op in production (isMockMode is false → real link runs as before).
      if (isMockMode) return;
      if (!merchantId || !solanaWallet.walletAddress) return;
      if (merchantInfo?.wallet_address === solanaWallet.walletAddress) return;
      const attemptKey = `${merchantId}:${solanaWallet.walletAddress}`;
      if (walletLinkAttemptedRef.current === attemptKey) return;
      walletLinkAttemptedRef.current = attemptKey;

      try {
        if (typeof solanaWallet.signMessage !== 'function') {
          console.warn('[Merchant] Wallet does not expose signMessage — skipping auto-link.');
          return;
        }

        const { nonce, message, signature } = await signLoginNonce(
          solanaWallet.walletAddress,
          solanaWallet.signMessage,
        );

        const res = await fetchWithAuth('/api/auth/merchant', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchant_id: merchantId,
            wallet_address: solanaWallet.walletAddress,
            signature,
            message,
            nonce,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            // Update the in-memory store. The DB is the durable copy; on
            // next mount /api/auth/me re-reads it. No localStorage mirror.
            setMerchantInfo((prev: any) => prev ? { ...prev, wallet_address: solanaWallet.walletAddress! } : prev);
            void refreshOnboardingRef.current();
          }
        } else {
          // Reset the guard on failure so a manual retry (e.g. user rejected
          // the signature prompt) can re-attempt on next state change.
          walletLinkAttemptedRef.current = null;
          console.error('[Merchant] Failed to link wallet:', await res.text());
        }
      } catch (err) {
        walletLinkAttemptedRef.current = null;
        console.error('[Merchant] Error linking wallet:', err);
      }
    };

    updateMerchantWallet();
  }, [merchantId, solanaWallet.walletAddress, solanaWallet.signMessage, merchantInfo?.wallet_address]);

  // Auto-fix: call acceptTrade on-chain for orders where I'm buyer but haven't joined escrow
  const acceptTradeFixRef = useRef(new Set<string>());
  useEffect(() => {
    if (isMockMode || !solanaWallet.connected || !merchantId || orders.length === 0) return;

    const fixOrders = async () => {
      for (const order of orders) {
        if (acceptTradeFixRef.current.has(order.id)) continue;
        if (order.myRole !== 'buyer') continue;
        if (!order.escrowCreatorWallet || order.escrowTradeId == null) continue;
        // Skip terminal states, pending, and escrowed orders (no backend accept needed)
        const dbStatus = order.dbOrder?.status || order.minimalStatus || '';
        if (['completed', 'cancelled', 'expired', 'pending', 'escrow'].includes(order.status)) continue;
        if (['escrowed', 'payment_sent', 'completed', 'cancelled', 'expired'].includes(dbStatus)) continue;

        try {
          await solanaWallet.acceptTrade({
            creatorPubkey: order.escrowCreatorWallet,
            tradeId: order.escrowTradeId,
          });

          acceptTradeFixRef.current.add(order.id);
        } catch (err: any) {
          const msg = err?.message || '';
          if (msg.includes('CannotAccept') || msg.includes('0x177d') || msg.includes('6013')) {

            acceptTradeFixRef.current.add(order.id);
          } else if (msg.includes('AccountNotInitialized') || msg.includes('0xbc4') || msg.includes('3012')) {
            console.warn(`[AutoFix] Escrow not on-chain for order ${order.id} — skipping`);
            acceptTradeFixRef.current.add(order.id);
          } else {
            console.error(`[AutoFix] acceptTrade FAILED for order ${order.id}:`, msg);
          }
        }
      }
    };

    fixOrders();
  }, [orders, solanaWallet.connected, merchantId, isMockMode, solanaWallet]);

  // Auto-refund scan for expired/cancelled orders
  const lastRefundScanRef = useRef<number>(0);
  useEffect(() => {
    if (!solanaWallet.connected || !solanaWallet.walletAddress || isMockMode) return;
    if (orders.length === 0) return;
    const now = Date.now();
    if (now - lastRefundScanRef.current < 30000) return;
    lastRefundScanRef.current = now;

    const stuckEscrows = orders.filter(o =>
      (o.status === 'expired' || o.status === 'cancelled') &&
      o.escrowTxHash &&
      !o.refundTxHash &&
      o.escrowTradeId != null &&
      o.escrowCreatorWallet === solanaWallet.walletAddress
    );

    if (stuckEscrows.length > 0) {

      for (const order of stuckEscrows) {
        autoRefundEscrow(order);
      }
    }
  }, [orders, solanaWallet.connected, solanaWallet.walletAddress, isMockMode, autoRefundEscrow]);

  // Recovery: retry recording any unrecorded on-chain escrows from localStorage
  const didRecoveryScanRef = useRef(false);
  useEffect(() => {
    if (didRecoveryScanRef.current || !merchantId || isMockMode) return;
    didRecoveryScanRef.current = true;

    try {
      // Pass 1: orders that exist in DB but their escrow record didn't make it
      // (key = blip_unrecorded_escrow_<orderId>). Existing recovery flow.
      const escrowKeys = Object.keys(localStorage).filter(k => k.startsWith('blip_unrecorded_escrow_'));
      for (const key of escrowKeys) {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        if (!data.orderId || !data.txHash) { localStorage.removeItem(key); continue; }
        if (Date.now() - (data.timestamp || 0) > 86400000) { localStorage.removeItem(key); continue; }

        const payload: Record<string, unknown> = {
          tx_hash: data.txHash,
          actor_type: 'merchant',
          actor_id: merchantId,
        };
        if (data.escrowPda) payload.escrow_address = data.escrowPda;
        if (data.tradeId != null) payload.escrow_trade_id = data.tradeId;
        if (data.tradePda) payload.escrow_trade_pda = data.tradePda;
        if (data.escrowPda) payload.escrow_pda = data.escrowPda;
        if (data.creatorWallet) payload.escrow_creator_wallet = data.creatorWallet;

        fetchWithAuth(`/api/orders/${data.orderId}/escrow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(res => {
          if (res.ok) {

            localStorage.removeItem(key);
          }
        }).catch(() => {});
      }

      // Pass 2: merchant SELL orders whose initial create-order POST failed
      // after the on-chain escrow already funded. No DB row exists yet —
      // we're holding the full request body in localStorage and need to
      // create the order from scratch (idempotent via the saved key).
      const orphanKeys = Object.keys(localStorage).filter(k => k.startsWith('blip_orphan_merchant_sell_'));
      for (const key of orphanKeys) {
        let record: { payload?: Record<string, unknown>; idempotencyKey?: string; timestamp?: number } | null = null;
        try { record = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
        if (!record || !record.payload || !record.idempotencyKey) { localStorage.removeItem(key); continue; }
        // 7-day TTL — beyond that the on-chain escrow should be emergency-refunded.
        if (Date.now() - (record.timestamp || 0) > 7 * 86400000) { localStorage.removeItem(key); continue; }
        // Only retry if the saved merchant_id matches the active session.
        if ((record.payload as { merchant_id?: string }).merchant_id !== merchantId) continue;

        fetchWithAuth('/api/merchant/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': record.idempotencyKey,
          },
          body: JSON.stringify(record.payload),
        }).then(async (res) => {
          if (!res.ok) return;
          const body = await res.json().catch(() => null);
          if (body?.success) {

            localStorage.removeItem(key);
          }
        }).catch(() => {});
      }
    } catch {}
  }, [merchantId, isMockMode]);

  // Handle expired orders — UI cleanup only, trust backend expiry worker for status transitions
  const lastExpiryRunRef = useRef<number>(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastExpiryRunRef.current < 5000) return;

    const expiredPending = orders.filter(o => o.status === "pending" && o.expiresIn <= 0);
    const expiredEscrow = orders.filter(o => o.status === "escrow" && o.expiresIn <= 0);

    if (expiredPending.length === 0 && expiredEscrow.length === 0) return;
    lastExpiryRunRef.current = now;

    // Remove expired pending orders from UI (backend worker handles the actual status change)
    if (expiredPending.length > 0) {
      setOrders(prev => prev.filter(o => !(o.status === "pending" && o.expiresIn <= 0)));
    }

    // Auto-refund stuck escrows for expired orders I created
    for (const order of expiredEscrow) {
      const iAmEscrowCreator = order.escrowCreatorWallet === solanaWallet.walletAddress;
      if (iAmEscrowCreator && order.escrowTradeId != null && solanaWallet.connected && !isMockMode) {
        autoRefundEscrow(order);
      }
    }
  }, [orders, solanaWallet.walletAddress, solanaWallet.connected, addNotification]);

  // Proactive expiry warnings for active in-progress orders. The 120-min
  // accept window (CLAUDE.md rule 2) + the escrowed expires_at (rule 4) can
  // both silently time out if the merchant isn't watching — no sound, no
  // toast, just a passive banner on the card under 5 min. This fires a
  // toast + bell + audio cue at 30, 10, and 2 minutes out so the merchant
  // actually gets warned *before* the order cancels/disputes.
  //
  // Dedup: each (order_id, threshold) fires at most once for the lifetime
  // of the hook. Pruned automatically when the order leaves active statuses.
  //
  // payment_sent is intentionally excluded — it's a 24h compliance window,
  // not an inactivity timer, and a "30 min left" toast on a 24h clock is
  // just noise.
  const WARNING_THRESHOLDS_SEC = [30 * 60, 10 * 60, 2 * 60];
  const warnedRef = useRef<Map<string, Set<number>>>(new Map());

  // Tracks unacknowledged urgent warnings so the tab title and OS
  // notifications keep grabbing attention until the merchant returns.
  // Cleared on visibilitychange/focus or when no urgent orders remain.
  const urgentUnreadRef = useRef<number>(0);
  useEffect(() => {
    if (!orders.length) return;
    const ACTIVE = new Set(['accepted', 'escrowed', 'payment_pending']);

    const checkNow = () => {
      const now = Date.now();
      const liveOrderIds = new Set<string>();
      // Collect each order's single most-urgent newly-crossed threshold this
      // pass; the actual toast(s) are dispatched once after the loop so a burst
      // of stale thresholds (one order) or many expiring orders can't stack the
      // screen with simultaneous cards.
      const pending: Array<{
        orderId: string;
        mins: number;
        amt: string;
        urgent: boolean;
      }> = [];
      for (const order of orders) {
        const dbStatus = (order.dbOrder?.status || order.status) as string;
        if (!ACTIVE.has(dbStatus)) continue;

        // Skip orders this merchant has no stake in. The merchant store can
        // hold marketplace/broadcast orders that other merchants accepted —
        // expiry warnings on those are pure noise for non-stakeholders and
        // were the cause of the "warning shows for every merchant even if
        // they didn't accept" bug. Backend-enriched orders carry
        // `my_role` / `is_my_order`; for the rare order shape that lacks
        // both, fall back to checking merchant_id / buyer_merchant_id.
        const db = order.dbOrder;
        const isMine =
          (db?.is_my_order ?? false) ||
          db?.my_role === 'buyer' ||
          db?.my_role === 'seller' ||
          (
            db?.is_my_order === undefined &&
            db?.my_role === undefined &&
            merchantId != null &&
            (db?.merchant_id === merchantId || db?.buyer_merchant_id === merchantId)
          );
        if (!isMine) continue;

        liveOrderIds.add(order.id);
        const expiresAt = order.dbOrder?.expires_at;
        if (!expiresAt) continue;
        const remainingSec = Math.floor(
          (new Date(expiresAt).getTime() - now) / 1000,
        );
        if (remainingSec <= 0) continue;

        let warned = warnedRef.current.get(order.id);
        // Thresholds this order has already passed on this tick.
        const crossed = WARNING_THRESHOLDS_SEC.filter((t) => remainingSec <= t);
        const newlyCrossed = crossed.filter((t) => !warned?.has(t));
        if (newlyCrossed.length === 0) continue;
        if (!warned) {
          warned = new Set();
          warnedRef.current.set(order.id, warned);
        }
        // Mark EVERY crossed threshold as warned — including the stale higher
        // ones we're about to skip — so the backfill can't re-fire them as
        // separate toasts on later ticks. Then surface ONLY the most urgent
        // (smallest) newly-crossed threshold for this order.
        for (const t of crossed) warned.add(t);
        const fireThreshold = Math.min(...newlyCrossed);
        pending.push({
          orderId: order.id,
          mins: Math.max(1, Math.round(remainingSec / 60)),
          amt: order.amount ? `${order.amount} USDT` : 'Order',
          urgent: fireThreshold <= 2 * 60,
        });
      }

      // ── Dispatch ────────────────────────────────────────────────────────
      // One order → its own toast. Multiple orders crossing on the same pass →
      // a single coalesced summary so a wall of cards never appears at once.
      // Urgent warnings stick until clicked (duration 0); non-urgent keep the
      // 7s auto-dismiss. The tab-title flash + OS notification fire once.
      const fmtMsg = (p: { amt: string; mins: number; urgent: boolean }) =>
        p.urgent
          ? `${p.amt} expires in ~${p.mins} min — act now to avoid auto-cancel.`
          : `${p.amt} expires in ~${p.mins} min. Take action soon.`;

      if (pending.length === 1) {
        const p = pending[0];
        const msg = fmtMsg(p);
        try {
          if (p.urgent && toast?.showUrgentWarning) {
            toast.showUrgentWarning(msg, { title: 'Order Expiring', orderId: p.orderId });
          } else {
            toast?.showWarning?.(msg);
          }
        } catch {}
        try { playSound(p.urgent ? 'error' : 'notification'); } catch {}
        addNotification('system', msg, p.orderId);
        if (p.urgent) {
          urgentUnreadRef.current += 1;
          try { flashTabTitle(urgentUnreadRef.current, `${p.amt} expiring`); } catch {}
          try {
            if (notificationPermission() === 'default') void requestNotificationPermission();
            showOSNotification('Blip — Action Required', {
              body: msg,
              tag: `urgent-${p.orderId}`,
            });
          } catch {}
        }
      } else if (pending.length > 1) {
        const count = pending.length;
        const anyUrgent = pending.some((p) => p.urgent);
        const summary = anyUrgent
          ? `${count} orders are expiring — act now to avoid auto-cancel.`
          : `${count} orders need action soon. Tap an order to continue.`;
        try {
          if (anyUrgent && toast?.showUrgentWarning) {
            toast.showUrgentWarning(summary, { title: `${count} Orders Expiring` });
          } else {
            toast?.showWarning?.(summary);
          }
        } catch {}
        try { playSound(anyUrgent ? 'error' : 'notification'); } catch {}
        // The persistent notifications panel is a log, not the on-screen
        // pile-up — keep a per-order entry there so nothing is lost.
        for (const p of pending) addNotification('system', fmtMsg(p), p.orderId);
        if (anyUrgent) {
          urgentUnreadRef.current += pending.filter((p) => p.urgent).length;
          try { flashTabTitle(urgentUnreadRef.current, `${count} orders expiring`); } catch {}
          try {
            if (notificationPermission() === 'default') void requestNotificationPermission();
            showOSNotification('Blip — Action Required', {
              body: summary,
              tag: 'urgent-multi',
            });
          } catch {}
        }
      }

      // Prune dedup entries for orders that are no longer active
      // (completed/cancelled/expired/disputed) so the Map stays bounded.
      for (const id of warnedRef.current.keys()) {
        if (!liveOrderIds.has(id)) warnedRef.current.delete(id);
      }
    };

    checkNow();
    const id = setInterval(checkNow, 30_000);
    return () => clearInterval(id);
  }, [orders, merchantId, toast, playSound, addNotification]);

  // Restore the original tab title once the merchant returns to the tab,
  // and reset the urgent counter so future warnings start at 1 again.
  useEffect(() => {
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        urgentUnreadRef.current = 0;
        try { restoreTabTitle(); } catch {}
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onVisible);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', onVisible);
      }
      try { restoreTabTitle(); } catch {}
    };
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (activeChatId && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeChatId, chatWindows]);

  return {
    debouncedFetchConversations,
    fetchOrderConversationsRef,
  };
}
