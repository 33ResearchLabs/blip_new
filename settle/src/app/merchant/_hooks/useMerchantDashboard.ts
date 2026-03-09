/**
 * Orchestrator hook for the Merchant Dashboard.
 * Extracted from page.tsx — contains ALL state, effects, callbacks, and computed values.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { usePusher } from "@/context/PusherContext";
import { useSounds } from "@/hooks/useSounds";
import { useWebSocketChat } from "@/hooks/useWebSocketChat";
import { useWebSocketChatContextOptional } from "@/context/WebSocketChatContext";
import { useDirectChat } from "@/hooks/useDirectChat";
import { useToast } from "@/components/NotificationToast";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order } from "@/types/merchant";
import { getEffectiveStatus, isOrderExpired, mapDbOrderToUI, TRADER_CUT_CONFIG } from "@/lib/orders/mappers";
import { useNotifications } from "@/hooks/useNotifications";
import { useOrderFetching } from "@/hooks/useOrderFetching";
import { useDashboardAuth } from "@/hooks/useDashboardAuth";
import { useEscrowOperations } from "@/hooks/useEscrowOperations";
import { useDisputeHandlers } from "@/hooks/useDisputeHandlers";
import { useOrderActions } from "@/hooks/useOrderActions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useMerchantDashboard(solanaWallet: any) {
  const { playSound } = useSounds();
  const toast = useToast();
  const router = useRouter();

  // ─── Core state from Zustand store (shared across component tree) ───
  const orders = useMerchantStore(s => s.orders);
  const setOrders = useMerchantStore(s => s.setOrders);
  const merchantId = useMerchantStore(s => s.merchantId);
  const merchantInfo = useMerchantStore(s => s.merchantInfo);
  const setMerchantInfo = useMerchantStore(s => s.setMerchantInfo);
  const isLoggedIn = useMerchantStore(s => s.isLoggedIn);
  // ─── Filter/sort state from store (shared with PendingOrdersPanel) ───
  const searchQuery = useMerchantStore(s => s.searchQuery);
  const setSearchQuery = useMerchantStore(s => s.setSearchQuery);
  const isLoading = useMerchantStore(s => s.isLoading);

  // Solana wallet state
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showWalletPrompt, setShowWalletPrompt] = useState(false);
  const [walletUpdatePending, setWalletUpdatePending] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isNewMerchant, setIsNewMerchant] = useState(false);

  const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

  // Pusher context (needed before useOrderFetching for isPusherConnected)
  const { isConnected: isPusherConnected, setActor } = usePusher();

  // ─── Order fetching hook (manages all data fetching, polling, expiry) ───
  const {
    activeOffers, leaderboardData, inAppBalance, bigOrders, mempoolOrders, resolvedDisputes,
    effectiveBalance, setActiveOffers, setBigOrders, setMempoolOrders, setResolvedDisputes,
    fetchOrders, debouncedFetchOrders, fetchMempoolOrders, fetchActiveOffers,
    refreshBalance, refetchSingleOrder, afterMutationReconcile, dismissBigOrder,
  } = useOrderFetching({
    isMockMode,
    isPusherConnected,
    solanaUsdtBalance: solanaWallet.usdtBalance,
    solanaRefreshBalances: solanaWallet.refreshBalances,
  });

  // Embedded wallet UI state
  const embeddedWallet = (solanaWallet as any)?.embeddedWallet as {
    state: 'none' | 'locked' | 'unlocked';
    unlockWallet: (password: string) => Promise<boolean>;
    lockWallet: () => void;
    deleteWallet: () => void;
    setKeypairAndUnlock: (kp: any) => void;
  } | undefined;

  // ─── Auth hook (login, register, logout, session restore) ───
  const {
    loginForm, setLoginForm, registerForm, setRegisterForm,
    authTab, setAuthTab, loginError, setLoginError,
    isLoggingIn, isRegistering,
    handleLogin, handleRegister, handleLogout,
    handleMerchantUsername, handleProfileUpdated,
  } = useDashboardAuth({
    isMockMode,
    solanaWallet,
    setShowWalletPrompt,
    setShowUsernameModal,
  });

  const [showNotifications, setShowNotifications] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [showBigOrderWidget, setShowBigOrderWidget] = useState(false);
  // Responsive: 5-column on wide screens (16"+), 4-column on smaller
  const [isWideScreen, setIsWideScreen] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1536px)');
    setIsWideScreen(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsWideScreen(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // New dashboard panels
  const [showMessageHistory, setShowMessageHistory] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Profile and transactions modals
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showTransactionHistory, setShowTransactionHistory] = useState(false);
  const [showPaymentMethods, setShowPaymentMethods] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOpenTradeModal, setShowOpenTradeModal] = useState(false);
  const [showMerchantQuoteModal, setShowMerchantQuoteModal] = useState(false);
  const [selectedMempoolOrder, setSelectedMempoolOrder] = useState<any | null>(null);
  const [ratingModalData, setRatingModalData] = useState<{
    orderId: string;
    counterpartyName: string;
    counterpartyType: 'user' | 'merchant';
  } | null>(null);

  // Notifications (must be before escrow hook which depends on addNotification)
  const { notifications, setNotifications, addNotification, markNotificationRead } = useNotifications(merchantId, isLoggedIn);

  // ─── Escrow operations hook (lock, release, cancel) ───
  const escrow = useEscrowOperations({
    isMockMode,
    solanaWallet,
    effectiveBalance,
    inAppBalance,
    addNotification,
    playSound,
    afterMutationReconcile,
    fetchOrders,
    refreshBalance,
    setShowWalletModal,
    setRatingModalData,
  });

  const [openTradeForm, setOpenTradeForm] = useState({
    tradeType: "sell" as "buy" | "sell",
    cryptoAmount: "",
    paymentMethod: "bank" as "bank" | "cash",
    spreadPreference: "fastest" as "best" | "fastest" | "cheap",
    expiryMinutes: 15 as 15 | 90,
  });
  const [isMerchantOnline, setIsMerchantOnline] = useState(true);
  const [corridorForm, setCorridorForm] = useState({
    fromCurrency: "USDT",
    toCurrency: "AED",
    availableAmount: "",
    minAmount: "",
    maxAmount: "",
    rate: "3.67",
    premium: "0.25",
  });
  // Debounced amount validation for Open Trade modal
  const [tradeAmountWarning, setTradeAmountWarning] = useState<string | null>(null);
  const tradeAmountDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setTradeAmountWarning(null);
    if (tradeAmountDebounceRef.current) clearTimeout(tradeAmountDebounceRef.current);

    const amt = parseFloat(openTradeForm.cryptoAmount);
    if (!openTradeForm.cryptoAmount || !amt || amt <= 0) return;

    tradeAmountDebounceRef.current = setTimeout(() => {
      if (openTradeForm.tradeType === 'sell' && effectiveBalance !== null && amt > effectiveBalance) {
        setTradeAmountWarning(`Exceeds balance (${effectiveBalance.toLocaleString()} USDC available)`);
      } else if (amt < 1) {
        setTradeAmountWarning('Minimum amount is 1 USDC');
      }
    }, 600);

    return () => { if (tradeAmountDebounceRef.current) clearTimeout(tradeAmountDebounceRef.current); };
  }, [openTradeForm.cryptoAmount, openTradeForm.tradeType, effectiveBalance]);

  // Mobile view state
  const [mobileView, setMobileView] = useState<'orders' | 'escrow' | 'chat' | 'history' | 'marketplace'>('orders');
  const [marketSubTab, setMarketSubTab] = useState<'browse' | 'offers'>('browse');
  const [leaderboardTab, setLeaderboardTab] = useState<'traders' | 'rated' | 'reputation'>('traders');
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [leaderboardCollapsed, setLeaderboardCollapsed] = useState(false);
  const [historyTab, setHistoryTab] = useState<'completed' | 'cancelled' | 'stats'>('completed');
  const [completedTimeFilter, setCompletedTimeFilter] = useState<'today' | '7days' | 'all'>('all');
  // Order detail popup state
  const [selectedOrderPopup, setSelectedOrderPopup] = useState<Order | null>(null);
  const chatInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Order conversations state (for sidebar Messages section)
  const [orderConversations, setOrderConversations] = useState<{
    order_id: string;
    order_number: string;
    order_status: string;
    order_type: 'buy' | 'sell';
    crypto_amount: number;
    fiat_amount: number;
    fiat_currency: string;
    order_created_at: string;
    has_manual_message: boolean;
    user: {
      id: string;
      username: string;
      rating: number;
      total_trades: number;
    };
    message_count: number;
    unread_count: number;
    last_message: {
      id: string;
      content: string;
      sender_type: string;
      message_type: string;
      created_at: string;
      is_read: boolean;
    } | null;
    last_activity: string;
  }[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);

  // Active chat order details (for timeline when order not in main orders list)
  const [activeChatOrderDetails, setActiveChatOrderDetails] = useState<any | null>(null);

  // Fetch order details for timeline when opening chat
  const fetchOrderDetailsForChat = useCallback(async (orderId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setActiveChatOrderDetails(data.data);
      }
    } catch (error) {
      console.error('[Chat] Failed to fetch order details:', error);
    }
  }, []);

  // Fetch order conversations for sidebar
  const convAbortRef = useRef<AbortController | null>(null);
  const fetchOrderConversations = useCallback(async () => {
    if (!merchantId) return;
    convAbortRef.current?.abort();
    const controller = new AbortController();
    convAbortRef.current = controller;

    setIsLoadingConversations(true);
    try {
      const res = await fetch(`/api/merchant/messages?merchant_id=${merchantId}&limit=50`, { signal: controller.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setOrderConversations(data.data.conversations || []);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error('Failed to fetch order conversations:', error);
    } finally {
      if (!controller.signal.aborted) setIsLoadingConversations(false);
    }
  }, [merchantId]);

  // Ref to hold fetchOrderConversations for use in callbacks
  const fetchOrderConversationsRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Keep ref updated for use in callbacks
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

  // Real-time chat hook via WebSocket (replaces Pusher for chat)
  const {
    chatWindows,
    openChat,
    closeChat,
    sendMessage,
  } = useWebSocketChat({
    maxWindows: 10,
    actorType: "merchant",
    actorId: merchantId || undefined,
    onNewMessage: (chatId?: string, message?: { from: string; text: string }) => {
      playSound('message');
      fetchOrderConversationsRef.current?.();
      if (message && message.from !== 'me') {
        toast.showNewMessage('User', message.text?.substring(0, 80));
      }
    },
  });

  // Direct chat hook (people-based messaging)
  const directChat = useDirectChat({ merchantId: merchantId || undefined });

  // WebSocket context for order events
  const wsContext = useWebSocketChatContextOptional();

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

  // WebSocket order event handler — real-time order updates
  useEffect(() => {
    if (!wsContext) return;

    const unsubscribe = wsContext.onOrderEvent((event: any) => {
      const data = event.data as { orderId?: string; status?: string };

      if (event.type === 'order:status-updated') {
        const orderId = data.orderId;
        const newStatus = data.status;
        if (!orderId || !newStatus) return;

        // Optimistic local update
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

        // Full refresh to get all fields (buyer info, etc.)
        fetchOrders();
        debouncedFetchConversations();

        if (newStatus === 'payment_sent') { playSound('notification'); }
        else if (newStatus === 'completed') { playSound('order_complete'); refreshBalance(); }
      } else if (event.type === 'order:cancelled') {
        fetchOrders();
        playSound('error');
      } else if (event.type === 'order:created') {
        fetchOrders();
        playSound('new_order');
      }
    });

    return unsubscribe;
  }, [wsContext, fetchOrders, debouncedFetchConversations, playSound, refreshBalance]);

  // Keyboard shortcuts for dashboard
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputField = ['INPUT', 'TEXTAREA'].includes(target.tagName);

      // "/" to focus search
      if (e.key === '/' && !isInputField) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="Search"]');
        searchInput?.focus();
      }

      // "R" to refresh orders (not Cmd+R or Ctrl+R)
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
        const res = await fetch('/api/auth/merchant', {
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
  const acceptTradeSuccessRef = useRef(new Set<string>());
  const acceptTradeFailRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (isMockMode || !solanaWallet.connected || !merchantId || orders.length === 0) return;

    const fixOrders = async () => {
      for (const order of orders) {
        if (acceptTradeSuccessRef.current.has(order.id)) continue;
        if ((acceptTradeFailRef.current[order.id] || 0) >= 3) continue;
        if (order.myRole !== 'buyer') continue;
        if (!order.escrowCreatorWallet || order.escrowTradeId == null) continue;
        if (['completed', 'cancelled', 'expired', 'pending'].includes(order.status)) continue;

        try {
          console.log(`[AutoFix] Calling acceptTrade for order ${order.id} (wallet popup expected)`);
          await solanaWallet.acceptTrade({
            creatorPubkey: order.escrowCreatorWallet,
            tradeId: Number(order.escrowTradeId),
          });
          acceptTradeSuccessRef.current.add(order.id);
          console.log(`[AutoFix] acceptTrade succeeded for order ${order.id}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          acceptTradeFailRef.current[order.id] = (acceptTradeFailRef.current[order.id] || 0) + 1;
          if (msg.includes('already') || msg.includes('CannotAccept') || msg.includes('6011') || msg.includes('6012')) {
            acceptTradeSuccessRef.current.add(order.id);
            console.log(`[AutoFix] acceptTrade already done for order ${order.id}:`, msg);
          } else if (msg.includes('User rejected') || msg.includes('cancelled')) {
            acceptTradeFailRef.current[order.id] = Math.max((acceptTradeFailRef.current[order.id] || 0) - 1, 0);
            console.log(`[AutoFix] User dismissed wallet popup for order ${order.id}`);
          } else {
            console.warn(`[AutoFix] acceptTrade failed for order ${order.id} (attempt ${acceptTradeFailRef.current[order.id]}):`, msg);
          }
        }
      }
    };

    fixOrders();
  }, [orders, solanaWallet.connected, merchantId, isMockMode, solanaWallet.acceptTrade]);

  // Dispute hook
  const dispute = useDisputeHandlers({
    solanaWallet,
    addNotification,
    playSound,
    toast,
    afterMutationReconcile,
    fetchOrders,
  });
  const {
    showDisputeModal, setShowDisputeModal, disputeOrderId, setDisputeOrderId,
    disputeReason, setDisputeReason,
    disputeDescription, setDisputeDescription,
    isSubmittingDispute, disputeInfo, setDisputeInfo,
    isRespondingToResolution, extensionRequests, setExtensionRequests, requestingExtension,
    openDisputeModal, submitDispute, fetchDisputeInfo,
    requestExtension, respondToExtension, respondToResolution,
  } = dispute;

  // Real-time orders subscription - triggers refetch on updates
  useRealtimeOrders({
    actorType: 'merchant',
    actorId: merchantId,
    onOrderCreated: (order) => {
      debouncedFetchOrders();
      debouncedFetchConversations();
      const isRelevant = order?.merchant_id === merchantId || order?.buyer_merchant_id === merchantId;
      if (isRelevant) {
        playSound('new_order');
        const typeLabel = order?.type === 'buy' ? 'Sell' : 'Buy';
        const amt = order?.crypto_amount ? `${Number(order.crypto_amount).toLocaleString()} USDC` : '';
        const fiat = order?.fiat_amount ? `${Number(order.fiat_amount).toLocaleString()} AED` : '';
        addNotification('order',
          order ? `New ${typeLabel} order · ${amt}${fiat ? ` → ${fiat}` : ''}` : 'New order received',
          order?.id);
        toast.showOrderCreated(
          order ? `${typeLabel} ${order.crypto_amount} USDC for ${order.fiat_amount} AED` : undefined
        );
      }
    },
    onOrderStatusUpdated: (orderId, newStatus, _previousStatus, extra?: { buyerMerchantId?: string; merchantId?: string }) => {
      if (['accepted', 'cancelled', 'completed', 'expired', 'escrowed', 'payment_sent', 'payment_confirmed', 'disputed'].includes(newStatus)) {
        setOrders(prev => prev.map(o =>
          o.id === orderId ? { ...o, status: newStatus as any, minimalStatus: newStatus === 'escrowed' ? 'escrow' : newStatus, ...(newStatus === 'accepted' && extra?.buyerMerchantId ? { buyerMerchantId: extra.buyerMerchantId } : {}) } : o
        ));
      }

      debouncedFetchOrders();
      debouncedFetchConversations();
      const matchedOrder = orders.find(o => o.id === orderId);
      const isRelevantOrder = () => {
        return matchedOrder && (matchedOrder.orderMerchantId === merchantId || matchedOrder.buyerMerchantId === merchantId);
      };
      const amt = matchedOrder ? `${matchedOrder.amount.toLocaleString()} USDC` : '';
      const usr = matchedOrder?.user || '';
      const desc = amt ? (usr ? `${amt} · ${usr}` : amt) : '';

      if (newStatus === 'payment_sent') {
        // Toast/notification already shown by useOrderActions on API success.
      } else if (newStatus === 'escrowed') {
        // Toast/notification already shown by useEscrowOperations on API success.
      } else if (newStatus === 'completed') {
        refreshBalance();
      } else if (newStatus === 'disputed') {
        // Toast/notification already shown by useDisputeHandlers on API success.
      } else if (newStatus === 'cancelled') {
        if (isRelevantOrder()) {
          addNotification('system', desc ? `Order cancelled · ${desc}` : 'Order cancelled', orderId);
          playSound('error');
          toast.showOrderCancelled();
        }
      } else if (newStatus === 'expired') {
        if (isRelevantOrder()) {
          addNotification('system', amt ? `Order expired · ${amt} timed out` : 'Order expired', orderId);
          toast.showOrderExpired();
        }
      } else if (newStatus === 'accepted') {
        if (isRelevantOrder() && matchedOrder?.isMyOrder) {
          addNotification('order', desc ? `Your order accepted · ${desc}` : 'Your order has been accepted!', orderId);
          playSound('notification');
          toast.show({ type: 'order', title: 'Order Accepted!', message: 'Someone accepted your order!' });
        }
      } else if (newStatus === 'payment_confirmed') {
        addNotification('payment', amt ? `Payment confirmed · ${amt} · Ready to release` : 'Payment confirmed!', orderId);
        playSound('notification');
        toast.show({ type: 'payment', title: 'Payment Confirmed', message: 'Payment has been confirmed. Ready to release.' });
      }
    },
    onExtensionRequested: (data) => {
      if (data.requestedBy === 'user') {
        setExtensionRequests(prev => {
          const newMap = new Map(prev);
          newMap.set(data.orderId, {
            requestedBy: data.requestedBy,
            extensionMinutes: data.extensionMinutes,
            extensionCount: data.extensionCount,
            maxExtensions: data.maxExtensions,
          });
          return newMap;
        });
        addNotification('system', `User requested ${data.extensionMinutes}min extension`, data.orderId);
        playSound('notification');
        toast.showExtensionRequest('User', data.extensionMinutes);
      }
    },
    onExtensionResponse: (data) => {
      setExtensionRequests(prev => {
        const newMap = new Map(prev);
        newMap.delete(data.orderId);
        return newMap;
      });
      if (data.accepted) {
        addNotification('system', 'Extension accepted', data.orderId);
        debouncedFetchOrders();
        toast.show({ type: 'system', title: 'Extension Accepted', message: 'Time has been extended' });
      } else {
        addNotification('system', `Extension declined - order ${data.newStatus || 'updated'}`, data.orderId);
        debouncedFetchOrders();
        toast.showWarning('Extension request was declined');
      }
    },
    onPriceUpdate: (data) => {
      window.dispatchEvent(new CustomEvent("corridor-price-update", { detail: data }));
    },
  });

  // Auto-refund: refund on-chain escrow for expired orders using connected wallet
  const autoRefundInFlightRef = useRef<Set<string>>(new Set());
  const autoRefundEscrow = useCallback(async (order: Order) => {
    if (autoRefundInFlightRef.current.has(order.id)) return;
    if (order.refundTxHash) return;
    autoRefundInFlightRef.current.add(order.id);

    try {
      console.log(`[AutoRefund] Refunding escrow for order ${order.id}...`);
      const refundResult = await solanaWallet.refundEscrow({
        creatorPubkey: order.escrowCreatorWallet || '',
        tradeId: order.escrowTradeId || 0,
      });

      if (refundResult.success) {
        console.log(`[AutoRefund] Success: ${refundResult.txHash}`);
        addNotification('system', `Escrow auto-refunded! ${order.amount} USDC returned to your wallet.`, order.id);
        playSound('click');

        await fetch(`/api/orders/${order.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'cancelled',
            actor_type: 'merchant',
            actor_id: merchantId,
            refund_tx_hash: refundResult.txHash,
          }),
        });

        solanaWallet.refreshBalances?.();
        debouncedFetchOrders();
      } else {
        console.warn(`[AutoRefund] Failed for ${order.id}:`, refundResult.error);
        addNotification('system', `Auto-refund failed for ${order.amount} USDC. Use "Cancel & Withdraw" manually.`, order.id);
      }
    } catch (e) {
      console.error(`[AutoRefund] Error for ${order.id}:`, e);
    } finally {
      autoRefundInFlightRef.current.delete(order.id);
    }
  }, [solanaWallet, merchantId, addNotification, debouncedFetchOrders]);

  // Continuous scan: auto-refund any expired/cancelled orders with unreturned on-chain escrow
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

        fetch(`/api/orders/${data.orderId}/escrow`, {
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

  // Handle expired orders
  const lastExpiryRunRef = useRef<number>(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastExpiryRunRef.current < 5000) return;

    const expiredPending = orders.filter(o => o.status === "pending" && o.expiresIn <= 0);
    const expiredEscrow = orders.filter(o => o.status === "escrow" && o.expiresIn <= 0);

    if (expiredPending.length === 0 && expiredEscrow.length === 0) return;
    lastExpiryRunRef.current = now;

    if (expiredPending.length > 0) {
      setOrders(prev => prev.filter(o => !(o.status === "pending" && o.expiresIn <= 0)));

      Promise.allSettled(
        expiredPending.map(order =>
          fetch(`/api/orders/${order.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'expired',
              actor_type: 'system',
              actor_id: '00000000-0000-0000-0000-000000000000',
            }),
          }).catch(() => {})
        )
      ).then(() => fetchOrders());
    }

    for (const order of expiredEscrow) {
      fetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'expired',
          actor_type: 'system',
          actor_id: '00000000-0000-0000-0000-000000000000',
        }),
      }).catch(() => {});

      const iAmEscrowCreator = order.escrowCreatorWallet === solanaWallet.walletAddress;
      if (iAmEscrowCreator && order.escrowTradeId != null && solanaWallet.connected && !isMockMode) {
        autoRefundEscrow(order);
      }
    }
  }, [orders, solanaWallet.walletAddress, solanaWallet.connected, fetchOrders, addNotification]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (activeChatId && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeChatId, chatWindows]);

  // Destructure escrow hook (all escrow state + actions)
  const {
    showEscrowModal, escrowOrder, isLockingEscrow, escrowTxHash, escrowError,
    openEscrowModal, openEscrowModalForSell, executeLockEscrow, closeEscrowModal,
    showReleaseModal, releaseOrder, isReleasingEscrow, releaseTxHash, releaseError,
    openReleaseModal, executeRelease, closeReleaseModal,
    showCancelModal, cancelOrder, isCancellingEscrow, cancelTxHash, cancelError,
    openCancelModal, executeCancelEscrow, closeCancelModal,
    isCancellingOrder, cancelOrderWithoutEscrow,
  } = escrow;

  // Smart cancel: refund escrow if locked, otherwise simple cancel
  const handleCancelOrder = useCallback((order: Order) => {
    if (order.escrowTxHash) {
      openCancelModal(order);
    } else {
      cancelOrderWithoutEscrow(order.id);
    }
  }, [openCancelModal, cancelOrderWithoutEscrow]);

  // Fetch dispute info when viewing a chat for a disputed order
  useEffect(() => {
    const activeChat = chatWindows.find(c => c.id === activeChatId || c.orderId === activeChatId);
    if (activeChat?.orderId) {
      const order = orders.find(o => o.id === activeChat.orderId);
      if (order?.status === 'disputed') {
        fetchDisputeInfo(activeChat.orderId);
      } else {
        setDisputeInfo(null);
      }
    }
  }, [activeChatId, chatWindows, orders, fetchDisputeInfo]);

  const handleOpenChat = useCallback((order: Order) => {
    if (!merchantId) return;

    const dbOrder = order.dbOrder;
    let targetId: string;
    let targetType: 'user' | 'merchant';
    let targetName: string;

    if (order.myRole === 'buyer') {
      if (dbOrder?.merchant_id && dbOrder.merchant_id !== merchantId) {
        targetId = dbOrder.merchant_id;
        targetType = 'merchant';
        targetName = dbOrder.merchant?.display_name || 'Seller';
      } else {
        targetId = dbOrder?.user_id || '';
        targetType = 'user';
        targetName = order.user || 'User';
      }
    } else {
      if (dbOrder?.buyer_merchant_id && dbOrder.buyer_merchant_id !== merchantId) {
        targetId = dbOrder.buyer_merchant_id;
        targetType = 'merchant';
        targetName = dbOrder.buyer_merchant?.display_name || 'Buyer';
      } else {
        targetId = dbOrder?.user_id || '';
        targetType = 'user';
        targetName = order.user || 'User';
      }
    }

    if (!targetId) {
      console.warn('[Chat] No target ID found for order', order.id);
      return;
    }

    directChat.addContact(targetId, targetType);
    directChat.openChat(targetId, targetType, targetName);
  }, [merchantId, directChat]);

  // Order actions hook
  const orderActions = useOrderActions({
    isMockMode,
    solanaWallet,
    effectiveBalance,
    addNotification,
    playSound,
    afterMutationReconcile,
    setShowWalletModal,
    handleOpenChat,
    setSelectedOrderPopup,
    openEscrowModalForSell,
  });
  const {
    markingDone, isAccepting, isSigning, isCompleting, isConfirmingPayment,
    isCreatingTrade, setIsCreatingTrade, createTradeError, setCreateTradeError,
    acceptOrder, acceptWithSaed, signToClaimOrder, signAndProceed,
    markFiatPaymentSent, markPaymentSent, completeOrder, confirmPayment,
    handleDirectOrderCreation: rawHandleDirectOrderCreation,
  } = orderActions;

  // Wrap handleDirectOrderCreation to bind form state
  const handleDirectOrderCreation = useCallback((tradeType?: 'buy' | 'sell', priorityFee?: number) => {
    rawHandleDirectOrderCreation(openTradeForm, setOpenTradeForm, tradeType, priorityFee);
  }, [rawHandleDirectOrderCreation, openTradeForm, setOpenTradeForm]);

  // Filter orders by status
  const hasMyEscrow = useCallback((o: Order) => o.isMyOrder || o.myRole === 'seller' || o.orderMerchantId === merchantId, [merchantId]);

  const isSelfUnaccepted = useCallback((o: Order) => {
    const dbOrder = o.dbOrder;
    const isSelf = o.isMyOrder || o.orderMerchantId === merchantId;
    if (!isSelf) return false;
    const buyerMid = o.buyerMerchantId || dbOrder?.buyer_merchant_id;
    const hasExternalBuyer = buyerMid && buyerMid !== merchantId;
    return !dbOrder?.accepted_at && !hasExternalBuyer;
  }, [merchantId]);

  const pendingOrders = useMemo(() => orders.filter(o => {
    if (isOrderExpired(o)) return false;
    const status = getEffectiveStatus(o);
    if (status === "pending") return true;
    if (status === "escrow" && isSelfUnaccepted(o)) return true;
    return false;
  }), [orders, isSelfUnaccepted]);

  const ongoingOrders = useMemo(() => orders.filter(o => {
    const status = getEffectiveStatus(o);
    if (status !== "escrow") return false;
    if (isSelfUnaccepted(o)) return false;
    if (hasMyEscrow(o)) return true;
    return !isOrderExpired(o);
  }), [orders, isSelfUnaccepted, hasMyEscrow]);

  const completedOrders = useMemo(() => orders.filter(o => getEffectiveStatus(o) === "completed"), [orders]);

  const cancelledOrders = useMemo(() => orders.filter(o => {
    const status = getEffectiveStatus(o);
    return status === "cancelled" ||
      status === "disputed" ||
      ((status === "active" || status === "pending") && isOrderExpired(o)) ||
      (status === "escrow" && isOrderExpired(o) && !hasMyEscrow(o));
  }), [orders, hasMyEscrow]);

  const todayEarnings = useMemo(() => completedOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0), [completedOrders]);
  const totalTradedVolume = useMemo(() => completedOrders.reduce((sum, o) => sum + o.amount, 0), [completedOrders]);
  const pendingEarnings = useMemo(() => ongoingOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0), [ongoingOrders]);

  // Keep popup synced with live order data
  useEffect(() => {
    if (!selectedOrderPopup) return;
    const live = orders.find(o => o.id === selectedOrderPopup.id);
    if (live && live.status !== selectedOrderPopup.status) {
      setSelectedOrderPopup(live);
    }
  }, [orders, selectedOrderPopup]);

  const activeChat = chatWindows.find(c => c.id === activeChatId || c.orderId === activeChatId);
  const totalUnread = directChat.totalUnread;

  return {
    // Router
    router,
    // Core state
    orders, setOrders, merchantId, merchantInfo, setMerchantInfo, isLoggedIn, isLoading,
    searchQuery, setSearchQuery,
    // Wallet
    isMockMode, embeddedWallet,
    // Pusher
    isPusherConnected,
    // Order fetching
    activeOffers, leaderboardData, inAppBalance, bigOrders, mempoolOrders, resolvedDisputes,
    effectiveBalance, setActiveOffers, setBigOrders, setMempoolOrders, setResolvedDisputes,
    fetchOrders, debouncedFetchOrders, fetchMempoolOrders, fetchActiveOffers,
    refreshBalance, refetchSingleOrder, afterMutationReconcile, dismissBigOrder,
    // Auth
    loginForm, setLoginForm, registerForm, setRegisterForm,
    authTab, setAuthTab, loginError, setLoginError,
    isLoggingIn, isRegistering, isAuthenticating, setIsAuthenticating,
    handleLogin, handleRegister, handleLogout,
    handleMerchantUsername, handleProfileUpdated,
    // UI state
    showWalletModal, setShowWalletModal,
    showWalletPrompt, setShowWalletPrompt,
    walletUpdatePending, setWalletUpdatePending,
    showUsernameModal, setShowUsernameModal,
    isNewMerchant, setIsNewMerchant,
    showNotifications, setShowNotifications,
    activeChatId, setActiveChatId,
    showBigOrderWidget, setShowBigOrderWidget,
    isWideScreen,
    showMessageHistory, setShowMessageHistory,
    selectedOrderId, setSelectedOrderId,
    showProfileModal, setShowProfileModal,
    showTransactionHistory, setShowTransactionHistory,
    showPaymentMethods, setShowPaymentMethods,
    showAnalytics, setShowAnalytics,
    showCreateModal, setShowCreateModal,
    showOpenTradeModal, setShowOpenTradeModal,
    showMerchantQuoteModal, setShowMerchantQuoteModal,
    selectedMempoolOrder, setSelectedMempoolOrder,
    ratingModalData, setRatingModalData,
    selectedOrderPopup, setSelectedOrderPopup,
    // Notifications
    notifications, setNotifications, addNotification, markNotificationRead,
    // Escrow
    showEscrowModal, escrowOrder, isLockingEscrow, escrowTxHash, escrowError,
    openEscrowModal, openEscrowModalForSell, executeLockEscrow, closeEscrowModal,
    showReleaseModal, releaseOrder, isReleasingEscrow, releaseTxHash, releaseError,
    openReleaseModal, executeRelease, closeReleaseModal,
    showCancelModal, cancelOrder, isCancellingEscrow, cancelTxHash, cancelError,
    openCancelModal, executeCancelEscrow, closeCancelModal,
    isCancellingOrder, cancelOrderWithoutEscrow,
    // Trade form
    openTradeForm, setOpenTradeForm,
    isMerchantOnline, setIsMerchantOnline,
    corridorForm, setCorridorForm,
    tradeAmountWarning,
    // Mobile/desktop view
    mobileView, setMobileView,
    marketSubTab, setMarketSubTab,
    leaderboardTab, setLeaderboardTab,
    activityCollapsed, setActivityCollapsed,
    leaderboardCollapsed, setLeaderboardCollapsed,
    historyTab, setHistoryTab,
    completedTimeFilter, setCompletedTimeFilter,
    // Conversations
    orderConversations, isLoadingConversations, activeChatOrderDetails,
    fetchOrderDetailsForChat, fetchOrderConversations,
    // Chat
    chatWindows, openChat, closeChat, sendMessage, directChat,
    // Dispute
    showDisputeModal, setShowDisputeModal, disputeOrderId, setDisputeOrderId,
    disputeReason, setDisputeReason,
    disputeDescription, setDisputeDescription,
    isSubmittingDispute, disputeInfo, setDisputeInfo,
    isRespondingToResolution, extensionRequests, setExtensionRequests, requestingExtension,
    openDisputeModal, submitDispute, fetchDisputeInfo,
    requestExtension, respondToExtension, respondToResolution,
    // Order actions
    markingDone, isAccepting, isSigning, isCompleting, isConfirmingPayment,
    isCreatingTrade, setIsCreatingTrade, createTradeError, setCreateTradeError,
    acceptOrder, acceptWithSaed, signToClaimOrder, signAndProceed,
    markFiatPaymentSent, markPaymentSent, completeOrder, confirmPayment,
    handleDirectOrderCreation,
    // Computed
    pendingOrders, ongoingOrders, completedOrders, cancelledOrders,
    todayEarnings, totalTradedVolume, pendingEarnings,
    activeChat, totalUnread,
    hasMyEscrow, handleCancelOrder, handleOpenChat,
    // Sounds & toast
    playSound, toast,
    // Refs (for JSX)
    messagesEndRef, chatInputRefs,
  };
}
