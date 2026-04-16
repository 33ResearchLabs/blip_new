"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import { usePusher } from "@/context/PusherContext";
import { useWebSocketChatContextOptional } from "@/context/WebSocketChatContext";
import type { Order, DbOrder } from "@/types/merchant";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

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

        if (newStatus === 'payment_sent') { playSound('notification'); }
        else if (newStatus === 'completed') { playSound('order_complete'); refreshBalance(); }
      } else if (event.type === 'order:cancelled') {
        if (data.orderId) refetchSingleOrder(data.orderId);
        debouncedFetchOrders();
        playSound('error');
      } else if (event.type === 'order:created') {
        debouncedFetchOrders();
        playSound('new_order');
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

  // Update merchant wallet address when connected
  useEffect(() => {
    const updateMerchantWallet = async () => {
      if (!merchantId || !solanaWallet.walletAddress) return;
      if (merchantInfo?.wallet_address === solanaWallet.walletAddress) return;

      try {
        const res = await fetchWithAuth('/api/auth/merchant', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchant_id: merchantId,
            wallet_address: solanaWallet.walletAddress,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setMerchantInfo((prev: any) => prev ? { ...prev, wallet_address: solanaWallet.walletAddress! } : prev);
            const stored = localStorage.getItem('blip_merchant');
            if (stored) {
              const merchantData = JSON.parse(stored);
              merchantData.wallet_address = solanaWallet.walletAddress;
              localStorage.setItem('blip_merchant', JSON.stringify(merchantData));
            }
          }
        } else {
          console.error('[Merchant] Failed to link wallet:', await res.text());
        }
      } catch (err) {
        console.error('[Merchant] Error linking wallet:', err);
      }
    };

    updateMerchantWallet();
  }, [merchantId, solanaWallet.walletAddress, merchantInfo?.wallet_address]);

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
          console.log(`[AutoFix] acceptTrade succeeded for order ${order.id}`);
          acceptTradeFixRef.current.add(order.id);
        } catch (err: any) {
          const msg = err?.message || '';
          if (msg.includes('CannotAccept') || msg.includes('0x177d') || msg.includes('6013')) {
            console.log(`[AutoFix] acceptTrade already done for order ${order.id}`);
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
      console.log(`[AutoRefund] Found ${stuckEscrows.length} stuck escrow(s), refunding...`);
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
      const keys = Object.keys(localStorage).filter(k => k.startsWith('blip_unrecorded_escrow_'));
      for (const key of keys) {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        if (!data.orderId || !data.txHash) { localStorage.removeItem(key); continue; }
        if (Date.now() - (data.timestamp || 0) > 86400000) { localStorage.removeItem(key); continue; }

        console.log(`[EscrowRecovery] Retrying escrow recording for order ${data.orderId}`);
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
            console.log(`[EscrowRecovery] Successfully recorded escrow for ${data.orderId}`);
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
  useEffect(() => {
    if (!orders.length) return;
    const ACTIVE = new Set(['accepted', 'escrowed', 'payment_pending']);

    const checkNow = () => {
      const now = Date.now();
      const liveOrderIds = new Set<string>();
      for (const order of orders) {
        const dbStatus = (order.dbOrder?.status || order.status) as string;
        if (!ACTIVE.has(dbStatus)) continue;
        liveOrderIds.add(order.id);
        const expiresAt = order.dbOrder?.expires_at;
        if (!expiresAt) continue;
        const remainingSec = Math.floor(
          (new Date(expiresAt).getTime() - now) / 1000,
        );
        if (remainingSec <= 0) continue;

        let warned = warnedRef.current.get(order.id);
        for (const thresholdSec of WARNING_THRESHOLDS_SEC) {
          if (remainingSec > thresholdSec) continue;
          if (warned?.has(thresholdSec)) continue;
          if (!warned) {
            warned = new Set();
            warnedRef.current.set(order.id, warned);
          }
          warned.add(thresholdSec);
          const mins = Math.max(1, Math.round(remainingSec / 60));
          const amt = order.amount ? `${order.amount} USDT` : 'Order';
          const urgent = thresholdSec <= 2 * 60;
          const msg = urgent
            ? `${amt} expires in ~${mins} min — act now to avoid auto-cancel.`
            : `${amt} expires in ~${mins} min. Take action soon.`;
          try { toast?.showWarning?.(msg); } catch {}
          try { playSound(urgent ? 'error' : 'notification'); } catch {}
          addNotification('system', msg, order.id);
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
  }, [orders, toast, playSound, addNotification]);

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
