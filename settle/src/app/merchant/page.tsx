"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  Check,
  X,
  Shield,
  Bell,
  Wallet,
  Activity,
  Lock,
  Unlock,
  MessageCircle,
  Zap,
  DollarSign,
  ArrowRight,
  Crown,
  Sparkles,
  Plus,
  ArrowLeftRight,
  Globe,
  Percent,
  AlertTriangle,
  Loader2,
  LogOut,
  Clock,
  ExternalLink,
  RotateCcw,
  History,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { usePusher } from "@/context/PusherContext";
import { useSounds } from "@/hooks/useSounds";
import { useWebSocketChat } from "@/hooks/useWebSocketChat";
import { useWebSocketChatContextOptional } from "@/context/WebSocketChatContext";
import { useDirectChat } from "@/hooks/useDirectChat";
import { DirectChatView } from "@/components/merchant/DirectChatView";
import PWAInstallBanner from "@/components/PWAInstallBanner";
import { NotificationToastContainer, useToast, ConnectionIndicator, ActionPulse } from "@/components/NotificationToast";
import { MessageHistory } from "@/components/merchant/MessageHistory";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
import { OrderDetailsPanel } from "@/components/merchant/OrderDetailsPanel";
import { AnalyticsDashboard } from "@/components/merchant/AnalyticsDashboard";
import { TradeChat } from "@/components/merchant/TradeChat";
import { FileUpload } from "@/components/chat/FileUpload";
import { Marketplace } from "@/components/merchant/Marketplace";
import { MyOffers } from "@/components/merchant/MyOffers";
import { MerchantProfileModal } from "@/components/merchant/MerchantProfileModal";
import { TransactionHistoryModal } from "@/components/merchant/TransactionHistoryModal";
import { PaymentMethodModal } from "@/components/merchant/PaymentMethodModal";
import { TopRatedSellers } from "@/components/merchant/TopRatedSellers";
import { RatingModal } from "@/components/RatingModal";
import { MerchantQuoteModal } from "@/components/mempool/MerchantQuoteModal";
import { OrderInspector } from "@/components/mempool/OrderInspector";
import { DashboardWidgets } from "@/components/merchant/DashboardWidgets";
import { Package } from "lucide-react";
import { CorridorLPPanel } from "@/components/merchant/CorridorLPPanel";
import { getNextStep, type NextStepResult } from "@/lib/orders/getNextStep";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import { getAuthoritativeStatus, shouldAcceptUpdate, computeMyRole } from "@/lib/orders/statusResolver";
// New dashboard components
import { ConfigPanel } from "@/components/merchant/ConfigPanel";

import { PendingOrdersPanel } from "@/components/merchant/PendingOrdersPanel";
import { LeaderboardPanel } from "@/components/merchant/LeaderboardPanel";
import { InProgressPanel } from "@/components/merchant/InProgressPanel";
import { ActivityPanel } from "@/components/merchant/ActivityPanel";
import { CompletedOrdersPanel } from "@/components/merchant/CompletedOrdersPanel";
import { UserBadge } from "@/components/merchant/UserBadge";
import { MerchantNavbar } from "@/components/merchant/MerchantNavbar";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { useMerchantStore } from "@/stores/merchantStore";
import type { DbOrder, Order } from "@/types/merchant";
import { getUserEmoji, getEffectiveStatus, isOrderExpired, mapDbOrderToUI, TRADER_CUT_CONFIG, TOP_1_PERCENT_THRESHOLD } from "@/lib/orders/mappers";
import { useNotifications } from "@/hooks/useNotifications";
import { useOrderFetching } from "@/hooks/useOrderFetching";
import { useDashboardAuth } from "@/hooks/useDashboardAuth";
import { useEscrowOperations } from "@/hooks/useEscrowOperations";
import { useDisputeHandlers } from "@/hooks/useDisputeHandlers";
import { useOrderActions } from "@/hooks/useOrderActions";
import { LoginScreen } from "@/components/merchant/LoginScreen";
import { NotificationsPanel } from "@/components/merchant/NotificationsPanel";
import { MobileOrdersView } from "@/components/merchant/MobileOrdersView";
import { MobileEscrowView } from "@/components/merchant/MobileEscrowView";
import { MobileChatView } from "@/components/merchant/MobileChatView";
import { MobileHistoryView } from "@/components/merchant/MobileHistoryView";
import { MobileMarketplaceView } from "@/components/merchant/MobileMarketplaceView";
import { MobileBottomNav } from "@/components/merchant/MobileBottomNav";
import { CorridorCreateModal } from "@/components/merchant/CorridorCreateModal";
import { TradeFormModal } from "@/components/merchant/TradeFormModal";
import { OrderQuickView } from "@/components/merchant/OrderQuickView";
import type { CorridorFormState } from "@/components/merchant/CorridorCreateModal";
import type { OpenTradeFormState } from "@/components/merchant/TradeFormModal";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

// Dynamically import wallet components (client-side only)
const MerchantWalletModal = dynamic(() => import("@/components/MerchantWalletModal"), { ssr: false });
const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';
const UsernameModal = dynamic(() => import("@/components/UsernameModal"), { ssr: false });
const useSolanaWalletHook = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSolanaWallet } = require("@/context/SolanaWalletContext");
    return useSolanaWallet();
  } catch {
    return {
      connected: false,
      connecting: false,
      publicKey: null,
      walletAddress: null,
      signMessage: undefined,
      connect: () => {},
      disconnect: () => {},
      openWalletModal: () => {},
      solBalance: null,
      usdtBalance: null,
      refreshBalances: async () => {},
      depositToEscrow: async () => ({ txHash: '', success: false }),
      releaseEscrow: async () => ({ txHash: '', success: false }),
      refundEscrow: async () => ({ txHash: '', success: false }),
      // V2.3: Payment confirmation & disputes
      confirmPayment: async () => ({ txHash: '', success: false }),
      openDispute: async () => ({ txHash: '', success: false }),
      network: 'devnet' as const,
    };
  }
};

// (initialBigOrders moved to useOrderFetching hook)

export default function MerchantDashboard() {
  const { playSound } = useSounds();
  const toast = useToast();
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

  // Solana wallet state
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showWalletPrompt, setShowWalletPrompt] = useState(false);
  const [walletUpdatePending, setWalletUpdatePending] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isNewMerchant, setIsNewMerchant] = useState(false);

  // (Escrow state moved to useEscrowOperations hook — initialized after fetching hook)
  const solanaWallet = useSolanaWalletHook();
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
  const isLoading = useMerchantStore(s => s.isLoading);
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
    tradeType: "sell" as "buy" | "sell", // From merchant perspective: sell = merchant sells USDC to user
    cryptoAmount: "",
    paymentMethod: "bank" as "bank" | "cash",
    spreadPreference: "fastest" as "best" | "fastest" | "cheap",
    expiryMinutes: 15 as 15 | 90,
  });
  const [isMerchantOnline, setIsMerchantOnline] = useState(true);
  const [corridorForm, setCorridorForm] = useState({
    fromCurrency: "USDT",
    toCurrency: "AED",
    availableAmount: "", // How much USDT merchant wants to make available
    minAmount: "",
    maxAmount: "",
    rate: "3.67",
    premium: "0.25",
  });
  // (Filter/sort state moved to Zustand store — PendingOrdersPanel subscribes directly)
  // Mobile view state (consolidated: stats folded into history, offers folded into marketplace)
  const [mobileView, setMobileView] = useState<'orders' | 'escrow' | 'chat' | 'history' | 'marketplace'>('orders');
  const [marketSubTab, setMarketSubTab] = useState<'browse' | 'offers'>('browse');
  const [leaderboardTab, setLeaderboardTab] = useState<'traders' | 'rated' | 'reputation'>('traders');
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  // History tab filter: 'completed' | 'cancelled' | 'stats'
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
  const [activeChatOrderDetails, setActiveChatOrderDetails] = useState<DbOrder | null>(null);

  // Fetch order details for timeline when opening chat
  const fetchOrderDetailsForChat = useCallback(async (orderId: string) => {
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}`);
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
      const res = await fetchWithAuth(`/api/merchant/messages?merchant_id=${merchantId}&limit=50`, { signal: controller.signal });
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

  // Ref to hold fetchOrderConversations for use in callbacks
  const fetchOrderConversationsRef = useRef<(() => Promise<void>) | undefined>(undefined);

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

  // WebSocket context for order events (effect is below, after fetchOrders is defined)
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
  // This ensures email/password merchants can link their wallet for escrow releases
  useEffect(() => {
    const updateMerchantWallet = async () => {
      // Only update if we have both merchantId and wallet address
      if (!merchantId || !solanaWallet.walletAddress) return;

      // Check if merchant already has this wallet linked (from merchantInfo)
      if (merchantInfo?.wallet_address === solanaWallet.walletAddress) {
        return;
      }

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
            // Update local state to reflect the linked wallet
            setMerchantInfo((prev: any) => prev ? { ...prev, wallet_address: solanaWallet.walletAddress! } : prev);
            // Update localStorage too
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
        // Only for orders where I'm the buyer, escrow exists, and order is active
        if (order.myRole !== 'buyer') continue;
        if (!order.escrowCreatorWallet || order.escrowTradeId == null) continue;
        if (['completed', 'cancelled', 'expired', 'pending'].includes(order.status)) continue;

        acceptTradeFixRef.current.add(order.id);
        try {
          await solanaWallet.acceptTrade({
            creatorPubkey: order.escrowCreatorWallet,
            tradeId: order.escrowTradeId,
          });
          console.log(`[AutoFix] Called acceptTrade for order ${order.id}`);
        } catch {
          // Already accepted or other error — fine
        }
      }
    };

    fixOrders();
  }, [orders, solanaWallet.connected, merchantId, isMockMode, solanaWallet]);

  // Dispute hook — must be before useRealtimeOrders (callbacks reference setExtensionRequests)
  const dispute = useDisputeHandlers({
    solanaWallet,
    addNotification,
    playSound,
    toast,
    afterMutationReconcile,
    fetchOrders,
  });
  const {
    showDisputeModal, disputeOrderId,
    disputeReason, setDisputeReason,
    disputeDescription, setDisputeDescription,
    isSubmittingDispute, disputeInfo, setDisputeInfo,
    isRespondingToResolution, extensionRequests, setExtensionRequests, requestingExtension,
    openDisputeModal, closeDisputeModal, submitDispute, fetchDisputeInfo,
    requestExtension, respondToExtension, respondToResolution,
  } = dispute;

  // Real-time orders subscription - triggers refetch on updates
  useRealtimeOrders({
    actorType: 'merchant',
    actorId: merchantId,
    onOrderCreated: (order) => {
      debouncedFetchOrders();
      debouncedFetchConversations();
      // Only show notification/sound/toast for orders relevant to this merchant
      // (assigned to me or I'm the buyer). Other merchants' orders still appear
      // in the order list via fetchOrders but don't trigger disruptive alerts.
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
      // Optimistic update for accepted orders — show acceptor immediately
      if (newStatus === 'accepted' && extra?.buyerMerchantId) {
        setOrders(prev => prev.map(o =>
          o.id === orderId ? { ...o, buyerMerchantId: extra.buyerMerchantId, minimalStatus: 'accepted' } : o
        ));
      }

      // Full refetch to get authoritative data
      debouncedFetchOrders();
      debouncedFetchConversations();
      // Helper: check if this order is relevant to us (our offer or we're buyer)
      // Used to suppress noisy notifications from global broadcast statuses
      const matchedOrder = orders.find(o => o.id === orderId);
      const isRelevantOrder = () => {
        return matchedOrder && (matchedOrder.orderMerchantId === merchantId || matchedOrder.buyerMerchantId === merchantId);
      };
      // Build descriptive suffix from order data
      const amt = matchedOrder ? `${matchedOrder.amount.toLocaleString()} USDC` : '';
      const usr = matchedOrder?.user || '';
      const desc = amt ? (usr ? `${amt} · ${usr}` : amt) : '';

      if (newStatus === 'payment_sent') {
        addNotification('payment', desc ? `Payment marked sent · ${desc}` : 'Payment sent for order', orderId);
        playSound('notification');
        toast.showPaymentSent(orderId);
      } else if (newStatus === 'escrowed') {
        addNotification('escrow', amt ? `Escrow locked · ${amt} secured` : 'Escrow locked on order', orderId);
        playSound('notification');
        toast.showEscrowLocked();
      } else if (newStatus === 'completed') {
        addNotification('complete', desc ? `Trade completed! ${desc}` : 'Trade completed!', orderId);
        playSound('order_complete');
        toast.showTradeComplete();
        refreshBalance();
      } else if (newStatus === 'disputed') {
        addNotification('dispute', desc ? `Dispute opened · ${desc}` : 'Dispute opened on order', orderId);
        playSound('error');
        toast.showDisputeOpened(orderId);
      } else if (newStatus === 'cancelled') {
        // 'cancelled' is broadcast to all merchants - only notify involved ones
        if (isRelevantOrder()) {
          addNotification('system', desc ? `Order cancelled · ${desc}` : 'Order cancelled', orderId);
          playSound('error');
          toast.showOrderCancelled();
        }
      } else if (newStatus === 'expired') {
        // 'expired' is broadcast to all merchants - only notify involved ones
        if (isRelevantOrder()) {
          addNotification('system', amt ? `Order expired · ${amt} timed out` : 'Order expired', orderId);
          toast.showOrderExpired();
        }
      } else if (newStatus === 'accepted') {
        // Only notify the ORDER CREATOR, not the acceptor (they already know)
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
      // Dispatch to Marketplace component via custom event (avoids prop drilling)
      window.dispatchEvent(new CustomEvent("corridor-price-update", { detail: data }));
    },
  });

  // WS order events handled by useRealtimeOrders (unified Pusher+WS stream).
  // Expiry timer moved to useOrderFetching hook.

  // Auto-refund: refund on-chain escrow for expired orders using connected wallet
  const autoRefundInFlightRef = useRef<Set<string>>(new Set());
  const autoRefundEscrow = useCallback(async (order: Order) => {
    // Prevent double-refund attempts
    if (autoRefundInFlightRef.current.has(order.id)) return;
    if (order.refundTxHash) return; // Already refunded
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

        // Update backend with refund tx hash
        await fetchWithAuth(`/api/orders/${order.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'cancelled',
            actor_type: 'merchant',
            actor_id: merchantId,
            refund_tx_hash: refundResult.txHash,
          }),
        });

        // Refresh balances and orders
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
  // Runs on every order list refresh (not just once) to catch newly cancelled orders
  const lastRefundScanRef = useRef<number>(0);
  useEffect(() => {
    if (!solanaWallet.connected || !solanaWallet.walletAddress || isMockMode) return;
    if (orders.length === 0) return;
    // Throttle: max once per 30s
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
        // Skip if older than 24h
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

  // Handle expired orders: separate effect, batched API calls, runs max once per 5s
  const lastExpiryRunRef = useRef<number>(0);
  useEffect(() => {
    // Throttle: don't run more than once per 5 seconds
    const now = Date.now();
    if (now - lastExpiryRunRef.current < 5000) return;

    const expiredPending = orders.filter(o => o.status === "pending" && o.expiresIn <= 0);
    const expiredEscrow = orders.filter(o => o.status === "escrow" && o.expiresIn <= 0);

    if (expiredPending.length === 0 && expiredEscrow.length === 0) return;
    lastExpiryRunRef.current = now;

    // Batch expire all pending orders
    if (expiredPending.length > 0) {
      // Remove from UI immediately
      setOrders(prev => prev.filter(o => !(o.status === "pending" && o.expiresIn <= 0)));

      // Fire API calls in parallel, then single refetch
      Promise.allSettled(
        expiredPending.map(order =>
          fetchWithAuth(`/api/orders/${order.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'expired',
              actor_type: 'system',
              actor_id: '00000000-0000-0000-0000-000000000000',
            }),
          }).catch(() => {}) // Swallow individual errors
        )
      ).then(() => fetchOrders());
    }

    // Handle expired escrow orders — auto-refund on-chain if we're the depositor
    for (const order of expiredEscrow) {
      // Mark expired on backend first
      fetchWithAuth(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'expired',
          actor_type: 'system',
          actor_id: '00000000-0000-0000-0000-000000000000',
        }),
      }).catch(() => {});

      // Auto-refund: if I'm the escrow creator and wallet is connected, refund automatically
      const iAmEscrowCreator = order.escrowCreatorWallet === solanaWallet.walletAddress;
      if (iAmEscrowCreator && order.escrowTradeId != null && solanaWallet.connected && !isMockMode) {
        autoRefundEscrow(order);
      }
    }
  }, [orders, solanaWallet.walletAddress, solanaWallet.connected, fetchOrders, addNotification]);

  // Background polling + visibility handled by Tier 2/3 smart polling above.

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
    cancelOrderWithoutEscrow,
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

  // Handler for creating trades from TradeFormModal
  const handleCreateTrade = async () => {
    if (!merchantId) return;

    // For SELL orders: Lock escrow FIRST, then create order
    // For BUY orders: Create order immediately (acceptor will lock escrow)

    if (openTradeForm.tradeType === "sell") {
      setIsCreatingTrade(true);
      setCreateTradeError(null);

      try {
        // Check balance first
        if (effectiveBalance !== null && effectiveBalance < parseFloat(openTradeForm.cryptoAmount)) {
          setCreateTradeError(`Insufficient USDC balance. You need ${openTradeForm.cryptoAmount} USDC but have ${effectiveBalance.toFixed(2)} USDC.`);
          setIsCreatingTrade(false);
          return;
        }

        // Find a merchant BUY offer to match with
        const offerParams = new URLSearchParams({
          amount: openTradeForm.cryptoAmount,
          type: 'buy',
          payment_method: openTradeForm.paymentMethod,
          exclude_merchant: merchantId,
        });
        const offerRes = await fetchWithAuth(`/api/offers?${offerParams}`);
        const offerData = await offerRes.json();

        let matchedOffer: { id: string; merchant?: { wallet_address?: string; display_name?: string } } | null = null;
        if (offerRes.ok && offerData.success && offerData.data) {
          matchedOffer = offerData.data;
        }

        // Validate counterparty wallet (skip in mock mode)
        if (!isMockMode) {
          const counterpartyWallet = matchedOffer?.merchant?.wallet_address;
          const isValidWallet = counterpartyWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(counterpartyWallet);

          if (!isValidWallet) {
            setCreateTradeError('No matching merchant with a linked wallet found. Please try a different amount or wait for merchants to add liquidity.');
            setIsCreatingTrade(false);
            return;
          }
        }

        // Lock escrow directly (no modal)
        let escrowResult: { success: boolean; txHash: string; tradeId?: number; tradePda?: string; escrowPda?: string; error?: string };
        if (isMockMode) {
          const mockTxHash = `mock-escrow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          escrowResult = { success: true, txHash: mockTxHash };
        } else {
          escrowResult = await solanaWallet.depositToEscrowOpen({
            amount: parseFloat(openTradeForm.cryptoAmount),
            side: 'sell',
          });
        }

        if (!escrowResult.success || !escrowResult.txHash) {
          throw new Error(escrowResult.error || 'Escrow transaction failed');
        }

        // Create order with escrow details
        const res = await fetchWithAuth("/api/merchant/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchant_id: merchantId,
            type: openTradeForm.tradeType,
            crypto_amount: parseFloat(openTradeForm.cryptoAmount),
            payment_method: openTradeForm.paymentMethod,
            spread_preference: openTradeForm.spreadPreference,
            matched_offer_id: matchedOffer?.id,
            escrow_tx_hash: escrowResult.txHash,
            escrow_trade_id: escrowResult.tradeId,
            escrow_trade_pda: escrowResult.tradePda,
            escrow_pda: escrowResult.escrowPda,
            escrow_creator_wallet: solanaWallet.walletAddress,
          }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          console.error('[Merchant] Create sell order failed:', data);
          setCreateTradeError(data.error || "Failed to create order after escrow lock");
          setIsCreatingTrade(false);
          return;
        }

        // Add to orders list
        if (data.data) {
          const newOrder = mapDbOrderToUI(data.data, merchantId);
          setOrders(prev => [newOrder, ...prev]);
          playSound('trade_complete');
          addNotification('escrow', `Sell order created! ${parseFloat(openTradeForm.cryptoAmount).toLocaleString()} USDC locked in escrow`, data.data?.id);
        }

        refreshBalance();

        // Success - close modal
        setShowOpenTradeModal(false);
        setOpenTradeForm({
          tradeType: "sell",
          cryptoAmount: "",
          paymentMethod: "bank",
          spreadPreference: "fastest",
          expiryMinutes: 15,
        });

      } catch (error) {
        console.error("Error creating sell order:", error);
        const errorMsg = error instanceof Error ? error.message : 'Network error';
        setCreateTradeError(errorMsg);
      } finally {
        setIsCreatingTrade(false);
      }
      return;
    }

    // For BUY orders: Create order immediately (no escrow needed from creator)
    setIsCreatingTrade(true);
    setCreateTradeError(null);

    try {
      const res = await fetchWithAuth("/api/merchant/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_id: merchantId,
          type: openTradeForm.tradeType,
          crypto_amount: parseFloat(openTradeForm.cryptoAmount),
          payment_method: openTradeForm.paymentMethod,
          spread_preference: openTradeForm.spreadPreference,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        console.error('[Merchant] Create trade failed:', data);
        setCreateTradeError(data.error || "Failed to create trade");
        return;
      }

      // Add to orders list
      if (data.data) {
        const newOrder = mapDbOrderToUI(data.data, merchantId);
        setOrders(prev => [newOrder, ...prev]);
        addNotification('order', `Buy order created for ${parseFloat(openTradeForm.cryptoAmount).toLocaleString()} USDC`, data.data?.id);
      }

      // Success - close modal
      setShowOpenTradeModal(false);
      setOpenTradeForm({
        tradeType: "sell",
        cryptoAmount: "",
        paymentMethod: "bank",
        spreadPreference: "fastest",
        expiryMinutes: 15,
      });
    } catch (error) {
      console.error("Error creating buy order:", error);
      setCreateTradeError("Network error. Please try again.");
    } finally {
      setIsCreatingTrade(false);
    }
  };

  const handleOpenChat = (order: Order) => {
    if (!merchantId) return;

    const dbOrder = order.dbOrder;
    let targetId: string;
    let targetType: 'user' | 'merchant';
    let targetName: string;

    if (order.myRole === 'buyer') {
      // I'm the buyer — chat with the seller
      if (dbOrder?.merchant_id && dbOrder.merchant_id !== merchantId) {
        targetId = dbOrder.merchant_id;
        targetType = 'merchant';
        targetName = dbOrder.merchant_username || dbOrder.merchant_display_name || order.user || 'Seller';
      } else {
        targetId = dbOrder?.user_id || order.user || '';
        targetType = 'user';
        targetName = order.user || 'User';
      }
    } else {
      // I'm the seller — chat with the buyer
      if (dbOrder?.buyer_merchant_id && dbOrder.buyer_merchant_id !== merchantId) {
        targetId = dbOrder.buyer_merchant_id;
        targetType = 'merchant';
        targetName = dbOrder.buyer_merchant_username || dbOrder.buyer_merchant_display_name || order.user || 'Buyer';
      } else {
        targetId = dbOrder?.user_id || order.user || '';
        targetType = 'user';
        targetName = order.user || 'User';
      }
    }

    if (!targetId) {
      console.warn('[Chat] No target ID found for order', order.id);
      return;
    }

    // Add contact and open chat (don't wait for addContact to resolve)
    directChat.addContact(targetId, targetType);
    directChat.openChat(targetId, targetType, targetName);
  };

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
    markingDone, isCreatingTrade, setIsCreatingTrade, createTradeError, setCreateTradeError,
    acceptOrder, acceptWithSaed, signToClaimOrder, signAndProceed,
    markFiatPaymentSent, markPaymentSent, completeOrder, confirmPayment,
    handleDirectOrderCreation: rawHandleDirectOrderCreation,
  } = orderActions;

  // Wrap handleDirectOrderCreation to bind form state
  const handleDirectOrderCreation = useCallback((tradeType?: 'buy' | 'sell', priorityFee?: number) => {
    rawHandleDirectOrderCreation(openTradeForm, setOpenTradeForm, tradeType, priorityFee);
  }, [rawHandleDirectOrderCreation, openTradeForm, setOpenTradeForm]);

  // Filter orders by status - Flow: New Orders → Active → Ongoing → Completed
  // CRITICAL: Orders with MY escrow must ALWAYS be visible (never silently dropped)
  const hasMyEscrow = (o: Order) => o.isMyOrder || o.myRole === 'seller' || o.orderMerchantId === merchantId;

  // Self escrowed order not yet accepted by another party → stays in New Orders
  const isSelfUnaccepted = (o: Order) => {
    const dbOrder = o.dbOrder;
    const isSelf = o.isMyOrder || o.orderMerchantId === merchantId;
    if (!isSelf) return false;
    // Not accepted if: no accepted_at, or buyer_merchant_id is me or absent
    const buyerMid = o.buyerMerchantId || dbOrder?.buyer_merchant_id;
    const hasExternalBuyer = buyerMid && buyerMid !== merchantId;
    return !dbOrder?.accepted_at && !hasExternalBuyer;
  };

  // "pending" = New Orders (includes self escrowed orders waiting for acceptance)
  const pendingOrders = useMemo(() => orders.filter(o => {
    if (isOrderExpired(o)) return false;
    const status = getEffectiveStatus(o);
    if (status === "pending") return true;
    // Self escrowed but not accepted → show in New Orders column
    if (status === "escrow" && isSelfUnaccepted(o)) return true;
    return false;
  }), [orders]);
  // "escrow" = In Progress — my escrowed orders are NEVER filtered by expiry (my funds are locked)
  // Exclude self-unaccepted orders (they stay in New Orders)
  const ongoingOrders = useMemo(() => orders.filter(o => {
    const status = getEffectiveStatus(o);
    if (status !== "escrow") return false;
    if (isSelfUnaccepted(o)) return false; // stays in New Orders
    if (hasMyEscrow(o)) return true;
    return !isOrderExpired(o);
  }), [orders]);
  const completedOrders = useMemo(() => orders.filter(o => getEffectiveStatus(o) === "completed"), [orders]);
  // Cancelled/expired — but never steal my escrowed orders into this bucket
  const cancelledOrders = useMemo(() => orders.filter(o => {
    const status = getEffectiveStatus(o);
    return status === "cancelled" ||
      status === "disputed" ||
      ((status === "active" || status === "pending") && isOrderExpired(o)) ||
      (status === "escrow" && isOrderExpired(o) && !hasMyEscrow(o));
  }), [orders]);

  // Calculate trader earnings using "best" rate (most common preference)
  // Trader earns 0.5% of each completed trade
  const todayEarnings = useMemo(() => completedOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0), [completedOrders]);
  const totalTradedVolume = useMemo(() => completedOrders.reduce((sum, o) => sum + o.amount, 0), [completedOrders]);
  const pendingEarnings = useMemo(() => ongoingOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0), [ongoingOrders]);

  const activeChat = chatWindows.find(c => c.id === activeChatId || c.orderId === activeChatId);
  const totalUnread = directChat.totalUnread;

  // Loading screen - show while checking session
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#060606] text-white flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.08] border border-white/[0.08] flex items-center justify-center mx-auto mb-4">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          </div>
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Login screen
  if (!isLoggedIn) {
    return (
      <LoginScreen
        authTab={authTab}
        setAuthTab={setAuthTab}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        registerForm={registerForm}
        setRegisterForm={setRegisterForm}
        loginError={loginError}
        setLoginError={setLoginError}
        isLoggingIn={isLoggingIn}
        isRegistering={isRegistering}
        isAuthenticating={isAuthenticating}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
    );
  }

  return (
    <div data-testid="merchant-dashboard" className="h-screen bg-[#060606] text-white flex flex-col overflow-hidden">
      {/* Toast Notifications */}
      <NotificationToastContainer position="top-right" />

      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[600px] h-[400px] bg-white/[0.02] rounded-full blur-[150px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-white/[0.01] rounded-full blur-[200px]" />
      </div>

      {/* Top Navbar */}
      <MerchantNavbar
        activePage="dashboard"
        merchantInfo={merchantInfo}
        embeddedWalletState={embeddedWallet?.state}
        onLogout={handleLogout}
        rightActions={
          <>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowTransactionHistory(true)}
              className="p-2 rounded-lg transition-all bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05]"
              title="Transaction History"
            >
              <History className="w-[18px] h-[18px] text-white/40" />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowPaymentMethods(true)}
              className="p-2 rounded-lg transition-all bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05]"
              title="Payment Methods"
            >
              <Plus className="w-[18px] h-[18px] text-white/40" />
            </motion.button>
            <ConnectionIndicator isConnected={isPusherConnected} />
          </>
        }
      />

      {/* Mobile Stats Bar - Shows on mobile only */}
      <div className="md:hidden flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.02] border-b border-white/[0.04]">
        {/* USDT Balance */}
        <button
          onClick={() => setShowWalletModal(true)}
          className="flex items-center gap-1 px-2 py-1 bg-white/[0.04] rounded-md border border-white/[0.08] shrink-0"
        >
          <span className="text-[11px] font-mono text-white/70">
            {effectiveBalance !== null
              ? `${effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
              : "—"}
          </span>
        </button>

        {/* Volume */}
        <div className="flex items-center gap-1 px-2 py-1 bg-white/[0.03] rounded-md shrink-0">
          <span className="text-[10px] font-mono text-gray-400">${totalTradedVolume.toLocaleString()}</span>
        </div>

        <div className="flex-1" />

        {/* Notifications */}
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className="relative p-2.5 bg-white/[0.04] rounded-md shrink-0"
        >
          <Bell className="w-4 h-4 text-gray-400" />
          {notifications.filter(n => !n.read).length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full text-[9px] font-bold flex items-center justify-center text-white">
              {notifications.filter(n => !n.read).length}
            </span>
          )}
        </button>
      </div>

      {/* Main Layout: Content + Sidebar */}
      {/* DESKTOP: Responsive 4-col (13-14") or 5-col (16"+) Layout */}
      <div className="hidden md:flex md:flex-col h-screen overflow-hidden">
        {/* Main Resizable Grid */}
        <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden" key={isWideScreen ? 'wide' : 'narrow'}>
        {/* LEFT: Balance Widget + Create Order Widget */}
        <Panel defaultSize={isWideScreen ? "20%" : "24%"} minSize={isWideScreen ? "14%" : "16%"} maxSize={isWideScreen ? "30%" : "35%"} id="left">
        <div className="flex flex-col h-full bg-[#060606] overflow-y-auto p-2 gap-2">
          {/* Widget 1: Balance */}
          <div className="glass-card rounded-xl overflow-hidden flex-shrink-0 border border-white/[0.06]" style={{ height: '48%', minHeight: '260px' }}>
            <DashboardWidgets
              todayEarnings={todayEarnings}
              completedOrders={completedOrders.length}
              cancelledOrders={cancelledOrders.length}
              avgResponseMins={0}
              rank={12}
              balance={effectiveBalance || 0}
              lockedInEscrow={245.50}
              isOnline={isMerchantOnline}
              merchantId={merchantId || undefined}
              onToggleOnline={() => setIsMerchantOnline(prev => !prev)}
              onOpenCorridor={() => window.open('/merchant/mempool', '_blank')}
            />
          </div>

          {/* Widget 2: Create Order */}
          <div className="glass-card rounded-xl overflow-hidden flex-1 min-h-0 border border-white/[0.06]">
            <ConfigPanel
              merchantId={merchantId}
              merchantInfo={merchantInfo}
              effectiveBalance={effectiveBalance}
              openTradeForm={openTradeForm}
              setOpenTradeForm={setOpenTradeForm}
              isCreatingTrade={isCreatingTrade}
              onCreateOrder={handleDirectOrderCreation}
              refreshBalance={refreshBalance}
            />
          </div>
        </div>
        </Panel>

        <PanelResizeHandle className="w-[3px]" />

        {/* CENTER-LEFT: Pending Orders (+ Leaderboard on narrow screens) */}
        <Panel defaultSize={isWideScreen ? "24%" : "27%"} minSize="16%" maxSize={isWideScreen ? "35%" : "40%"} id="center-left">
        <div className="flex flex-col h-full bg-black">
          {isWideScreen ? (
            <PendingOrdersPanel
              orders={pendingOrders}
              mempoolOrders={mempoolOrders}
              merchantInfo={merchantInfo}
              onSelectOrder={setSelectedOrderPopup}
              onSelectMempoolOrder={setSelectedMempoolOrder}
              onCancelOrder={handleCancelOrder}
              onOpenChat={handleOpenChat}
              fetchOrders={fetchOrders}
            />
          ) : (
            <>
              <div style={{ height: '60%' }} className="flex flex-col border-b border-white/[0.04]">
                <PendingOrdersPanel
                  orders={pendingOrders}
                  mempoolOrders={mempoolOrders}
                  merchantInfo={merchantInfo}
                  onSelectOrder={setSelectedOrderPopup}
                  onSelectMempoolOrder={setSelectedMempoolOrder}
                  onCancelOrder={handleCancelOrder}
                  onOpenChat={handleOpenChat}
                  fetchOrders={fetchOrders}
                />
              </div>
              <div className="flex-1 flex flex-col min-h-0">
                <LeaderboardPanel
                  leaderboardData={leaderboardData}
                  leaderboardTab={leaderboardTab}
                  setLeaderboardTab={setLeaderboardTab}
                />
              </div>
            </>
          )}
        </div>
        </Panel>

        <PanelResizeHandle className="w-[3px]" />

        {/* CENTER-RIGHT: In Progress + Completed (+ Activity on narrow screens) */}
        <Panel defaultSize={isWideScreen ? "20%" : "27%"} minSize={isWideScreen ? "14%" : "18%"} maxSize={isWideScreen ? "32%" : "40%"} id="center-right">
        <div className="flex flex-col h-full bg-black">
          <div style={{ height: '50%' }} className="flex flex-col border-b border-white/[0.04]">
            <InProgressPanel
              orders={ongoingOrders}
              onSelectOrder={setSelectedOrderPopup}
              onOpenChat={handleOpenChat}
              onOpenDispute={(order) => openDisputeModal(order.id)}
            />
          </div>
          <div style={{ height: '50%' }} className="flex flex-col border-b border-white/[0.04]">
            <CompletedOrdersPanel
              orders={completedOrders}
              onSelectOrder={setSelectedOrderPopup}
            />
          </div>
          {!isWideScreen && (
            <div className="flex-1 flex flex-col min-h-0">
              <ActivityPanel
                merchantId={merchantId}
                completedOrders={completedOrders}
                cancelledOrders={cancelledOrders}
                ongoingOrders={ongoingOrders}
                pendingOrders={pendingOrders}
                onRateOrder={(order) => {
                  const userName = order.user || 'User';
                  const counterpartyType = order.isM2M ? 'merchant' : 'user';
                  setRatingModalData({
                    orderId: order.id,
                    counterpartyName: userName,
                    counterpartyType,
                  });
                }}
                onSelectOrder={(orderId) => setSelectedOrderId(orderId)}
                onCollapseChange={setActivityCollapsed}
              />
            </div>
          )}
        </div>
        </Panel>

        {/* 5th COLUMN: Leaderboard + Activity (wide screens only) */}
        {isWideScreen && (
          <>
            <PanelResizeHandle className="w-[3px]" />
            <Panel defaultSize="18%" minSize="12%" maxSize="30%" id="transactions">
            <div className="flex flex-col h-full bg-black">
              <div style={{ height: activityCollapsed ? '100%' : '50%' }} className="flex flex-col min-h-0 border-b border-white/[0.04] transition-all duration-200">
                <LeaderboardPanel
                  leaderboardData={leaderboardData}
                  leaderboardTab={leaderboardTab}
                  setLeaderboardTab={setLeaderboardTab}
                />
              </div>
              <div style={{ height: activityCollapsed ? 'auto' : '50%' }} className="flex flex-col transition-all duration-200">
                <ActivityPanel
                  merchantId={merchantId}
                  completedOrders={completedOrders}
                  cancelledOrders={cancelledOrders}
                  ongoingOrders={ongoingOrders}
                  pendingOrders={pendingOrders}
                  onRateOrder={(order) => {
                    const userName = order.user || 'User';
                    const counterpartyType = order.isM2M ? 'merchant' : 'user';
                    setRatingModalData({
                      orderId: order.id,
                      counterpartyName: userName,
                      counterpartyType,
                    });
                  }}
                  onSelectOrder={(orderId) => setSelectedOrderId(orderId)}
                  onCollapseChange={setActivityCollapsed}
                />
              </div>
            </div>
            </Panel>
          </>
        )}

        <PanelResizeHandle className="w-[3px]" />

        {/* RIGHT SIDEBAR: Notifications (max 50%) + Chat (rest) */}
        <Panel defaultSize={isWideScreen ? "18%" : "22%"} minSize={isWideScreen ? "12%" : "15%"} maxSize={isWideScreen ? "30%" : "35%"} id="right">
        <div className="flex flex-col h-full bg-[#060606] overflow-hidden">
          {/* Notifications Panel - Top, max 50% of sidebar */}
          <NotificationsPanel
            notifications={notifications}
            onMarkRead={markNotificationRead}
            onSelectOrder={setSelectedOrderId}
          />

          {/* Chat Messages Panel - Bottom (takes remaining space) */}
          <div className="flex-1 flex flex-col min-h-0">
            {directChat.activeContactId ? (
              <DirectChatView
                contactName={directChat.activeContactName}
                contactType={directChat.activeContactType}
                messages={directChat.messages}
                isLoading={directChat.isLoadingMessages}
                onSendMessage={(text, imageUrl) => {
                  directChat.sendMessage(text, imageUrl);
                  playSound('send');
                }}
                onBack={() => directChat.closeChat()}
              />
            ) : (
              <MerchantChatTabs
                merchantId={merchantId || ''}
                conversations={directChat.conversations}
                totalUnread={directChat.totalUnread}
                isLoading={directChat.isLoadingConversations}
                onOpenChat={(targetId, targetType, username) => {
                  directChat.addContact(targetId, targetType).then(() => {
                    directChat.openChat(targetId, targetType, username);
                  });
                }}
              />
            )}
          </div>
        </div>
        </Panel>
        </PanelGroup>
      </div>

      {/* Mobile View Content - Shows on mobile only */}
      <div className="md:hidden flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-3 pb-20">
          {/* Mobile: Orders View */}
          {mobileView === 'orders' && (
            <MobileOrdersView
              pendingOrders={pendingOrders}
              bigOrders={bigOrders}
              onAcceptOrder={acceptOrder}
              onOpenChat={handleOpenChat}
              onDismissBigOrder={dismissBigOrder}
              setMobileView={setMobileView}
            />
          )}

          {/* Mobile: Escrow View */}
          {mobileView === 'escrow' && (
            <MobileEscrowView
              ongoingOrders={ongoingOrders}
              markingDone={markingDone}
              onOpenEscrowModal={openEscrowModal}
              onMarkFiatPaymentSent={markFiatPaymentSent}
              onOpenReleaseModal={openReleaseModal}
              onOpenDisputeModal={(orderId) => openDisputeModal(orderId)}
              onOpenCancelModal={openCancelModal}
              onOpenChat={handleOpenChat}
              setMobileView={setMobileView}
            />
          )}

          {/* Mobile: Chat View */}
          {mobileView === 'chat' && (
            <MobileChatView
              merchantId={merchantId}
              directChat={directChat}
              playSound={playSound}
            />
          )}

          {/* Mobile: History + Stats View */}
          {mobileView === 'history' && (
            <MobileHistoryView
              completedOrders={completedOrders}
              cancelledOrders={cancelledOrders}
              merchantId={merchantId}
              merchantInfo={merchantInfo}
              historyTab={historyTab}
              setHistoryTab={setHistoryTab}
              effectiveBalance={effectiveBalance}
              totalTradedVolume={totalTradedVolume}
              todayEarnings={todayEarnings}
              pendingEarnings={pendingEarnings}
              onShowAnalytics={() => setShowAnalytics(true)}
              onShowWalletModal={() => setShowWalletModal(true)}
              onLogout={handleLogout}
            />
          )}

          {/* Mobile: Marketplace + My Offers (segmented control) */}
          {mobileView === 'marketplace' && merchantId && (
            <MobileMarketplaceView
              merchantId={merchantId}
              marketSubTab={marketSubTab}
              setMarketSubTab={setMarketSubTab}
              onTakeOffer={(offer) => {
                setOpenTradeForm({
                  tradeType: offer.type === 'buy' ? 'sell' : 'buy',
                  cryptoAmount: '',
                  paymentMethod: offer.payment_method as 'bank' | 'cash',
                  spreadPreference: 'fastest',
                  expiryMinutes: 15,
                });
                setShowOpenTradeModal(true);
              }}
              onCreateOffer={() => setShowCreateModal(true)}
            />
          )}
        </main>
      </div>

      {/* Mobile FAB — Create Order */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowOpenTradeModal(true)}
        className="md:hidden fixed right-4 bottom-[88px] z-40 w-14 h-14 rounded-full bg-orange-500 shadow-lg shadow-orange-500/25 flex items-center justify-center"
      >
        <Plus className="w-6 h-6 text-black" />
      </motion.button>

      {/* Mobile Bottom Navigation — 5 tabs */}
      <MobileBottomNav
        mobileView={mobileView}
        setMobileView={setMobileView}
        pendingCount={pendingOrders.length}
        ongoingCount={ongoingOrders.length}
        totalUnread={totalUnread}
      />

      {/* Create Corridor Modal */}
      <CorridorCreateModal
        isOpen={showCreateModal}
        corridorForm={corridorForm}
        setCorridorForm={setCorridorForm}
        effectiveBalance={effectiveBalance}
        merchantId={merchantId}
        solanaWalletAddress={solanaWallet.walletAddress}
        onClose={() => setShowCreateModal(false)}
        onRefreshBalance={() => refreshBalance()}
        onFetchActiveOffers={fetchActiveOffers}
      />

      {/* Open Trade Modal */}
      <TradeFormModal
        isOpen={showOpenTradeModal}
        openTradeForm={openTradeForm}
        setOpenTradeForm={setOpenTradeForm}
        effectiveBalance={effectiveBalance}
        isCreatingTrade={isCreatingTrade}
        createTradeError={createTradeError}
        setCreateTradeError={setCreateTradeError}
        onClose={() => setShowOpenTradeModal(false)}
        onSubmit={handleCreateTrade}
      />

      {/* Dispute Modal */}
      <AnimatePresence>
        {showDisputeModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => closeDisputeModal()}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed z-50 w-full max-w-md inset-x-0 bottom-0 md:inset-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2"
            >
              <div className="bg-[#0c0c0c] rounded-t-2xl md:rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden pb-safe md:pb-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Report Issue</h2>
                      <p className="text-[11px] text-gray-500">Raise a dispute for this trade</p>
                    </div>
                  </div>
                  <button
                    onClick={() => closeDisputeModal()}
                    className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                  <p className="text-[13px] text-gray-400">
                    If you&apos;re having a problem with this trade, our support team will help resolve it.
                  </p>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Reason</label>
                    <select
                      value={disputeReason}
                      onChange={(e) => setDisputeReason(e.target.value)}
                      className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm text-white outline-none appearance-none border border-white/[0.04]"
                    >
                      <option value="">Select a reason...</option>
                      <option value="payment_not_received">Payment not received</option>
                      <option value="crypto_not_received">Crypto not received</option>
                      <option value="wrong_amount">Wrong amount sent</option>
                      <option value="fraud">Suspected fraud</option>
                      <option value="other">Other issue</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Description</label>
                    <textarea
                      value={disputeDescription}
                      onChange={(e) => setDisputeDescription(e.target.value)}
                      placeholder="Describe the issue in detail..."
                      rows={3}
                      className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm text-white outline-none placeholder:text-gray-600 border border-white/[0.04] resize-none"
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-3">
                  <button
                    onClick={() => closeDisputeModal()}
                    className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                  >
                    Cancel
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={submitDispute}
                    disabled={!disputeReason || isSubmittingDispute}
                    className="flex-[2] py-3 rounded-xl text-xs font-bold bg-red-500 text-white hover:bg-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmittingDispute ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    )}
                    {isSubmittingDispute ? "Submitting..." : "Submit Dispute"}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Escrow Lock Modal */}
      <AnimatePresence>
        {showEscrowModal && escrowOrder && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => !isLockingEscrow && closeEscrowModal()}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed z-50 w-full max-w-md inset-x-0 bottom-0 md:inset-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2"
            >
              <div className="bg-[#0c0c0c] rounded-t-2xl md:rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden pb-safe md:pb-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                      <Lock className="w-5 h-5 text-white/70" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Lock Escrow</h2>
                      <p className="text-[11px] text-gray-500">Secure USDC for this trade</p>
                    </div>
                  </div>
                  {!isLockingEscrow && (
                    <button
                      onClick={closeEscrowModal}
                      className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  )}
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                  {/* Order Info */}
                  <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl">
                        {escrowOrder.emoji}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{escrowOrder.user}</p>
                        <p className="text-xs text-gray-500">Buy Order</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Amount</p>
                        <p className="text-lg font-bold text-white">{escrowOrder.amount} USDC</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Fiat Value</p>
                        <p className="text-lg font-bold text-white">د.إ {Math.round(escrowOrder.total).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  {/* Wallet Balance */}
                  <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                    <span className="text-xs text-gray-500">Your USDC Balance</span>
                    <span className={`text-sm font-bold ${(effectiveBalance || 0) >= escrowOrder.amount ? 'text-white' : 'text-red-400'}`}>
                      {effectiveBalance?.toFixed(2) || '0.00'} USDC
                    </span>
                  </div>

                  {/* Transaction Status */}
                  {isLockingEscrow && !escrowTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 text-white/70 animate-spin" />
                        <div>
                          <p className="text-sm font-medium text-white/70">Processing Transaction</p>
                          <p className="text-xs text-white/40">{IS_EMBEDDED_WALLET ? 'Signing and sending on-chain...' : 'Please approve in your wallet...'}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success State */}
                  {escrowTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Escrow Locked Successfully!</p>
                          <p className="text-xs text-white/70">USDC is now secured on-chain</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <a
                          href={getSolscanTxUrl(escrowTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs text-white hover:text-white transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View on Solscan
                        </a>
                        {escrowOrder?.escrowPda && (
                          <a
                            href={getBlipscanTradeUrl(escrowOrder.escrowPda)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            BlipScan
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Error State */}
                  {escrowError && (
                    <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                        <div>
                          <p className="text-sm font-medium text-red-400">Transaction Failed</p>
                          <p className="text-xs text-red-400/70">{escrowError}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warning / Info */}
                  {!escrowTxHash && !isLockingEscrow && (() => {
                    // Determine recipient wallet - check all possible sources
                    const validWalletRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
                    const isValidWalletUI = (addr: string | undefined | null): boolean => {
                      if (!addr) return false;
                      return isMockMode ? addr.length > 0 : validWalletRegex.test(addr);
                    };
                    const hasBuyerMerchantWallet = isValidWalletUI(escrowOrder.buyerMerchantWallet);
                    const hasAcceptorWallet = isValidWalletUI(escrowOrder.acceptorWallet);
                    const hasUserWallet = isValidWalletUI(escrowOrder.userWallet);
                    const hasValidRecipient = hasBuyerMerchantWallet || hasAcceptorWallet || hasUserWallet;
                    // M2M trade: isM2M flag, buyerMerchantWallet, OR acceptorWallet (merchant accepted open order)
                    const isMerchantTrade = escrowOrder.isM2M || !!hasBuyerMerchantWallet || hasAcceptorWallet;

                    if (hasValidRecipient) {
                      return isMerchantTrade ? (
                        <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                          <p className="text-xs text-white/70">
                            🤝 <strong>Merchant Trade:</strong> You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow.
                            This will be released to the other merchant after they pay the fiat amount.
                          </p>
                        </div>
                      ) : (
                        <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                          <p className="text-xs text-white/70">
                            ⚠️ You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow on-chain.
                            This will be released to the buyer after they pay you the fiat amount.
                          </p>
                        </div>
                      );
                    } else {
                      // No recipient yet (SELL order before anyone accepts)
                      return (
                        <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                          <p className="text-xs text-white/70">
                            🔒 You are about to lock <strong>{escrowOrder.amount} USDC</strong> in escrow.
                            Once locked, your order will be visible to other merchants who can accept it.
                          </p>
                        </div>
                      );
                    }
                  })()}

                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-3">
                  {escrowTxHash ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={closeEscrowModal}
                      className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all"
                    >
                      Done
                    </motion.button>
                  ) : (
                    <>
                      <button
                        onClick={closeEscrowModal}
                        disabled={isLockingEscrow}
                        className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={executeLockEscrow}
                        disabled={
                          isLockingEscrow ||
                          (effectiveBalance || 0) < escrowOrder.amount
                        }
                        className="flex-[2] py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isLockingEscrow ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Locking...
                          </>
                        ) : (
                          <>
                            <Lock className="w-4 h-4" />
                            Lock {escrowOrder.amount} USDC
                          </>
                        )}
                      </motion.button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Escrow Release Modal */}
      <AnimatePresence>
        {showReleaseModal && releaseOrder && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => !isReleasingEscrow && closeReleaseModal()}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed z-50 w-full max-w-md inset-x-0 bottom-0 md:inset-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2"
            >
              <div className="bg-[#0c0c0c] rounded-t-2xl md:rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden pb-safe md:pb-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                      <Unlock className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Release Escrow</h2>
                      <p className="text-[11px] text-gray-500">Confirm payment & release USDC</p>
                    </div>
                  </div>
                  {!isReleasingEscrow && (
                    <button
                      onClick={closeReleaseModal}
                      className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  )}
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                  {/* Order Info */}
                  <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl">
                        {releaseOrder.emoji}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{releaseOrder.user}</p>
                        <p className="text-xs text-gray-500">Buy Order - Payment Received</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Release Amount</p>
                        <p className="text-lg font-bold text-white">{releaseOrder.amount} USDC</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Fiat Received</p>
                        <p className="text-lg font-bold text-white">د.إ {Math.round(releaseOrder.total).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  {/* Escrow Details */}
                  {releaseOrder.escrowTradeId && (
                    <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                      <span className="text-xs text-gray-500">Escrow Trade ID</span>
                      <span className="text-xs font-mono text-gray-400">#{releaseOrder.escrowTradeId}</span>
                    </div>
                  )}

                  {/* Transaction Status */}
                  {isReleasingEscrow && !releaseTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                        <div>
                          <p className="text-sm font-medium text-white">Processing Release</p>
                          <p className="text-xs text-white/70">Please approve in your wallet...</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success State */}
                  {releaseTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Escrow Released!</p>
                          <p className="text-xs text-white/70">{releaseOrder.amount} USDC sent to buyer</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <a
                          href={getSolscanTxUrl(releaseTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs text-white hover:text-white transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View on Solscan
                        </a>
                        {releaseOrder?.escrowPda && (
                          <a
                            href={getBlipscanTradeUrl(releaseOrder.escrowPda)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            BlipScan
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Error State */}
                  {releaseError && (
                    <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                        <div>
                          <p className="text-sm font-medium text-red-400">Release Failed</p>
                          <p className="text-xs text-red-400/70">{releaseError}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warning / Info */}
                  {!releaseTxHash && !isReleasingEscrow && (
                    <>
                      {(isMockMode || (releaseOrder.escrowTradeId && releaseOrder.escrowCreatorWallet && releaseOrder.userWallet)) ? (
                        <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.08]">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                              <Check className="w-4 h-4 text-white/70" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-white/70 mb-1">Ready to Release</p>
                              <p className="text-xs text-white/70">
                                Confirm you received <strong className="text-white">{releaseOrder.amount} USDC worth of AED</strong>.
                                Once released, the crypto will be sent to the buyer and <strong className="text-white">cannot be reversed</strong>.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                            <div>
                              <p className="text-sm font-semibold text-red-400 mb-1">Cannot Release Escrow</p>
                              <p className="text-xs text-red-400/80">
                                Missing on-chain escrow details. This order may not have been locked on-chain yet.
                              </p>
                              <ul className="text-xs text-red-400/70 mt-2 space-y-1">
                                {!releaseOrder.escrowTradeId && <li>• Missing Trade ID</li>}
                                {!releaseOrder.escrowCreatorWallet && <li>• Missing Creator Wallet</li>}
                                {!releaseOrder.userWallet && <li>• Missing Buyer Wallet</li>}
                              </ul>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-3">
                  {releaseTxHash ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={closeReleaseModal}
                      className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all"
                    >
                      Done
                    </motion.button>
                  ) : (
                    <>
                      <button
                        onClick={closeReleaseModal}
                        disabled={isReleasingEscrow}
                        className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={executeRelease}
                        disabled={isReleasingEscrow || (!isMockMode && (!releaseOrder.escrowTradeId || !releaseOrder.escrowCreatorWallet || !releaseOrder.userWallet))}
                        className={`flex-[2] py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                          isReleasingEscrow || (!isMockMode && (!releaseOrder.escrowTradeId || !releaseOrder.escrowCreatorWallet || !releaseOrder.userWallet))
                            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                            : 'bg-orange-500 hover:bg-orange-400 text-black'
                        }`}
                      >
                        {isReleasingEscrow ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Releasing...
                          </>
                        ) : (
                          <>
                            <Unlock className="w-4 h-4" />
                            Release Escrow
                          </>
                        )}
                      </motion.button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Cancel/Withdraw Escrow Modal */}
      <AnimatePresence>
        {showCancelModal && cancelOrder && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => !isCancellingEscrow && closeCancelModal()}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed z-50 w-full max-w-md inset-x-0 bottom-0 md:inset-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2"
            >
              <div className="bg-[#0c0c0c] rounded-t-2xl md:rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden pb-safe md:pb-0">
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                      <RotateCcw className="w-5 h-5 text-white/70" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Cancel & Withdraw</h2>
                      <p className="text-[11px] text-gray-500">Refund escrow to your wallet</p>
                    </div>
                  </div>
                  {!isCancellingEscrow && (
                    <button
                      onClick={closeCancelModal}
                      className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  )}
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                  {/* Order Info */}
                  <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.04]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl">
                        {cancelOrder.emoji}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{cancelOrder.user}</p>
                        <p className="text-xs text-gray-500">Buy Order - Escrow Locked</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Withdraw Amount</p>
                        <p className="text-lg font-bold text-white/70">{cancelOrder.amount} USDC</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Order Total</p>
                        <p className="text-lg font-bold text-white">د.إ {Math.round(cancelOrder.total).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  {/* Escrow Details */}
                  {cancelOrder.escrowTradeId && (
                    <div className="flex items-center justify-between bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                      <span className="text-xs text-gray-500">Escrow Trade ID</span>
                      <span className="text-xs font-mono text-gray-400">#{cancelOrder.escrowTradeId}</span>
                    </div>
                  )}

                  {/* Transaction Status */}
                  {isCancellingEscrow && !cancelTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 text-white/70 animate-spin" />
                        <div>
                          <p className="text-sm font-medium text-white/70">Processing Refund</p>
                          <p className="text-xs text-white/40">Please approve in your wallet...</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success State */}
                  {cancelTxHash && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/6">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Escrow Refunded!</p>
                          <p className="text-xs text-white/70">{cancelOrder.amount} USDC returned to your wallet</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <a
                          href={getSolscanTxUrl(cancelTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs text-white hover:text-white transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View on Solscan
                        </a>
                        {cancelOrder?.escrowPda && (
                          <a
                            href={getBlipscanTradeUrl(cancelOrder.escrowPda)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            BlipScan
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Error State */}
                  {cancelError && (
                    <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                        <div>
                          <p className="text-sm font-medium text-red-400">Refund Failed</p>
                          <p className="text-xs text-red-400/70">{cancelError}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warning */}
                  {!cancelTxHash && !isCancellingEscrow && (
                    <>
                      {cancelOrder.escrowTradeId && cancelOrder.escrowCreatorWallet ? (
                        <div className="bg-white/5 rounded-xl p-3 border border-white/6">
                          <p className="text-xs text-white/70">
                            This will cancel the order and return <strong>{cancelOrder.amount} USDC</strong> to your wallet. The buyer will be notified.
                          </p>
                        </div>
                      ) : (
                        <div className="bg-red-500/10 rounded-xl p-3 border border-red-500/20">
                          <p className="text-xs text-red-400">
                            Missing on-chain escrow details. Cannot refund.
                            {!cancelOrder.escrowTradeId && ' (No Trade ID)'}
                            {!cancelOrder.escrowCreatorWallet && ' (No Creator Wallet)'}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-3">
                  {cancelTxHash ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={closeCancelModal}
                      className="flex-1 py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all"
                    >
                      Done
                    </motion.button>
                  ) : (
                    <>
                      <button
                        onClick={closeCancelModal}
                        disabled={isCancellingEscrow}
                        className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                      >
                        Back
                      </button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={executeCancelEscrow}
                        disabled={isCancellingEscrow || !cancelOrder.escrowTradeId || !cancelOrder.escrowCreatorWallet}
                        className="flex-[2] py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isCancellingEscrow ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Refunding...
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            Cancel & Withdraw
                          </>
                        )}
                      </motion.button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* PWA Install Banner */}
      <PWAInstallBanner appName="Merchant" accentColor="#f97316" />

      {/* Wallet Connect Modal — skip in embedded wallet mode (no Solana adapter context) */}
      {!IS_EMBEDDED_WALLET && (
        <MerchantWalletModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
          onConnected={(address) => {
            setShowWalletModal(false);
          }}
        />
      )}

      {/* Username Modal for New Merchant Wallet Users */}
      {(solanaWallet.walletAddress || (typeof window !== 'undefined' && (window as any).phantom?.solana?.publicKey)) && (
        <UsernameModal
          isOpen={showUsernameModal}
          walletAddress={solanaWallet.walletAddress || (window as any).phantom?.solana?.publicKey?.toString()}
          onSubmit={handleMerchantUsername}
          canClose={false}
          apiEndpoint="/api/auth/merchant"
        />
      )}

      {/* Profile Picture Modal */}
      <MerchantProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        merchantId={merchantId || ''}
        currentAvatar={merchantInfo?.avatar_url}
        currentDisplayName={merchantInfo?.display_name}
        currentBio={merchantInfo?.bio}
        onProfileUpdated={handleProfileUpdated}
      />

      {/* Transaction History Modal */}
      <TransactionHistoryModal
        isOpen={showTransactionHistory}
        onClose={() => setShowTransactionHistory(false)}
        merchantId={merchantId || ''}
      />

      {/* Payment Methods Modal */}
      <PaymentMethodModal
        isOpen={showPaymentMethods}
        onClose={() => setShowPaymentMethods(false)}
        merchantId={merchantId || ''}
      />

      {/* Rating Modal */}
      {ratingModalData && merchantId && (
        <RatingModal
          orderId={ratingModalData.orderId}
          counterpartyName={ratingModalData.counterpartyName}
          counterpartyType={ratingModalData.counterpartyType}
          raterType="merchant"
          raterId={merchantId}
          onClose={() => setRatingModalData(null)}
          onSubmit={async (rating, review) => {
            try {
              const res = await fetchWithAuth('/api/ratings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  order_id: ratingModalData.orderId,
                  rater_type: 'merchant',
                  rater_id: merchantId,
                  rating,
                  review_text: review,
                }),
              });

              if (res.ok) {
                toast.show({
                  type: 'complete',
                  title: 'Rating Submitted',
                  message: `You rated ${ratingModalData.counterpartyName} ${rating} stars`,
                });
                // Refresh orders to update rating status
                fetchOrders();
              } else {
                const data = await res.json();
                throw new Error(data.error || 'Failed to submit rating');
              }
            } catch (error) {
              console.error('Failed to submit rating:', error);
              throw error;
            }
          }}
        />
      )}

      {/* Merchant Quote Modal */}
      {merchantId && (
        <MerchantQuoteModal
          merchantId={merchantId}
          corridorId="USDT_AED"
          isOpen={showMerchantQuoteModal}
          onClose={() => setShowMerchantQuoteModal(false)}
        />
      )}

      {/* Order Inspector Modal */}
      {selectedMempoolOrder && merchantId && (
        <OrderInspector
          order={selectedMempoolOrder}
          merchantId={merchantId}
          onClose={() => setSelectedMempoolOrder(null)}
          onBump={(orderId) => {
            setSelectedMempoolOrder(null);
          }}
          onAccept={(orderId) => {
            setSelectedMempoolOrder(null);
          }}
        />
      )}

      {/* Wallet Connection Prompt - shown after login if no wallet connected */}
      <AnimatePresence>
        {showWalletPrompt && !isMockMode && !IS_EMBEDDED_WALLET && !solanaWallet.connected && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 z-50"
              onClick={() => setShowWalletPrompt(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md bg-white/[0.03] rounded-2xl p-6 border border-white/10"
            >
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/[0.04] flex items-center justify-center">
                  <Wallet className="w-8 h-8 text-white/70" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Connect Your Wallet</h3>
                <p className="text-gray-400 text-sm mb-6">
                  Connect your Solana wallet to receive payments from escrow releases. This wallet will be saved to your account.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowWalletPrompt(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-gray-400 font-medium text-sm hover:bg-white/5 transition-colors"
                  >
                    Later
                  </button>
                  <button
                    onClick={() => {
                      setShowWalletPrompt(false);
                      setShowWalletModal(true);
                    }}
                    className="flex-1 px-4 py-3 rounded-xl bg-white/20 text-white font-medium text-sm hover:bg-white/[0.15] transition-colors flex items-center justify-center gap-2"
                  >
                    <Wallet className="w-4 h-4" />
                    Connect Wallet
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Order Detail Popup */}
      <OrderQuickView
        selectedOrder={selectedOrderPopup}
        merchantId={merchantId}
        markingDone={markingDone}
        onClose={() => setSelectedOrderPopup(null)}
        onAcceptOrder={acceptOrder}
        onOpenEscrowModal={openEscrowModal}
        onMarkFiatPaymentSent={markFiatPaymentSent}
        onConfirmPayment={confirmPayment}
        onCancelOrderWithoutEscrow={cancelOrderWithoutEscrow}
        onOpenChat={handleOpenChat}
        onViewFullDetails={(orderId) => setSelectedOrderId(orderId)}
      />

      {/* Order Details Panel */}
      {selectedOrderId && merchantId && (
        <OrderDetailsPanel
          orderId={selectedOrderId}
          merchantId={merchantId}
          onClose={() => setSelectedOrderId(null)}
          onOpenChat={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) handleOpenChat(order);
            setSelectedOrderId(null);
          }}
          onConfirmPayment={confirmPayment}
          onMarkPaymentSent={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) markPaymentSent(order);
          }}
          onAcceptOrder={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) acceptOrder(order);
          }}
          onCancelOrder={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) {
              if (order.escrowTxHash) {
                openCancelModal(order);
              } else {
                cancelOrderWithoutEscrow(order.id);
              }
            }
          }}
          onLockEscrow={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) openEscrowModal(order);
          }}
          onReleaseEscrow={(orderId) => {
            const order = orders.find(o => o.id === orderId);
            if (order) openReleaseModal(order);
          }}
          onOpenDispute={openDisputeModal}
        />
      )}

      {/* Message History Panel (Desktop) */}
      <AnimatePresence>
        {showMessageHistory && merchantId && (
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-md z-50 shadow-2xl bg-[#060606] border-l border-white/[0.04]"
          >
            {directChat.activeContactId ? (
              <DirectChatView
                contactName={directChat.activeContactName}
                contactType={directChat.activeContactType}
                messages={directChat.messages}
                isLoading={directChat.isLoadingMessages}
                onSendMessage={(text, imageUrl) => {
                  directChat.sendMessage(text, imageUrl);
                  playSound('send');
                }}
                onBack={() => directChat.closeChat()}
              />
            ) : (
              <MerchantChatTabs
                merchantId={merchantId}
                conversations={directChat.conversations}
                totalUnread={directChat.totalUnread}
                isLoading={directChat.isLoadingConversations}
                onOpenChat={(targetId, targetType, username) => directChat.openChat(targetId, targetType, username)}
                onClose={() => setShowMessageHistory(false)}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Analytics Dashboard Modal */}
      <AnimatePresence>
        {showAnalytics && merchantId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowAnalytics(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 sticky top-0 bg-zinc-900 z-10">
                <h2 className="text-lg font-semibold text-white">Analytics Dashboard</h2>
                <button
                  onClick={() => setShowAnalytics(false)}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5 text-white/60" />
                </button>
              </div>
              <div className="p-6">
                <AnalyticsDashboard merchantId={merchantId} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Wallet lives on /merchant/wallet — no popups needed */}
    </div>
  );
}
