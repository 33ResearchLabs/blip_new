"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Bell, Plus, Loader2, History, X } from "lucide-react";
import { usePusher } from "@/context/PusherContext";
import { useSounds } from "@/hooks/useSounds";
import { useWebSocketChat } from "@/hooks/useWebSocketChat";
// useDirectChat removed — replaced by order-based chat via useMerchantConversations
import {
  NotificationToastContainer,
  useToast,
  ConnectionIndicator,
} from "@/components/NotificationToast";
import { MerchantNavbar } from "@/components/merchant/MerchantNavbar";
import { MerchantSettingsOverlay } from "@/components/merchant/MerchantSettingsOverlay";
import { MerchantWalletOverlay } from "@/components/merchant/MerchantWalletOverlay";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order } from "@/types/merchant";
import {
  getEffectiveStatus,
  isOrderExpired,
  TRADER_CUT_CONFIG,
} from "@/lib/orders/mappers";
import { useNotifications } from "@/hooks/useNotifications";
import { useOrderFetching } from "@/hooks/useOrderFetching";
import { useDashboardAuth } from "@/hooks/useDashboardAuth";
import { useEscrowOperations } from "@/hooks/useEscrowOperations";
import { useDisputeHandlers } from "@/hooks/useDisputeHandlers";
import { useOrderActions } from "@/hooks/useOrderActions";
import { useAutoRefund } from "@/hooks/useAutoRefund";
import { useMerchantEffects } from "@/hooks/useMerchantEffects";
import { useMerchantConversations } from "@/hooks/useMerchantConversations";
import { useTradeCreation } from "@/hooks/useTradeCreation";
import { useMerchantRealtimeEvents } from "@/hooks/useMerchantRealtimeEvents";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { formatCrypto } from "@/lib/format";
import { useSolanaWallet } from "@/context/SolanaWalletContext";
import { MerchantModals } from "@/components/merchant/MerchantModals";
import { MerchantUpiPayModal } from "@/components/merchant/MerchantUpiPayModal";
import { SwapModal } from "@/components/merchant/SwapModal";
import { SendModal } from "@/components/merchant/SendModal";
import { DepositModal } from "@/components/merchant/DepositModal";
import { UnlockWalletModal } from "@/components/merchant/UnlockWalletModal";
import { PushPermissionPrompt } from "@/components/PushPermissionPrompt";
import { MerchantDesktopLayout } from "@/components/merchant/MerchantDesktopLayout";
import { MerchantTour } from "@/components/merchant/MerchantTour";
import { useMerchantTour } from "@/hooks/useMerchantTour";
import { MerchantMobileContent } from "@/components/merchant/MerchantMobileContent";
import { MobilePriceTicker } from "@/components/merchant/MobilePriceTicker";
import { OnboardingProvider } from "@/contexts/OnboardingContext";
import { OnboardingTour } from "@/components/merchant/OnboardingTour";

export default function MerchantDashboard() {
  const { playSound } = useSounds();
  const toast = useToast();
  const orders = useMerchantStore((s) => s.orders);
  const merchantId = useMerchantStore((s) => s.merchantId);
  const merchantInfo = useMerchantStore((s) => s.merchantInfo);
  const isLoggedIn = useMerchantStore((s) => s.isLoggedIn);
  const isLoading = useMerchantStore((s) => s.isLoading);

  // Onboarding tour — env-controlled, shows once per merchant on first login.
  // Pass DB completion timestamp so the hook can suppress the tour across
  // browsers / incognito / cleared localStorage. Falls back to localStorage
  // for legacy users who completed before DB persistence shipped.
  const tour = useMerchantTour(
    merchantId,
    (merchantInfo as { tour_completed_at?: string | null } | null)?.tour_completed_at,
  );

  const [showWalletModal, setShowWalletModal] = useState(false);
  // Shared modal state — works for both desktop StatusCard and mobile
  // home view. The modals themselves render at the page root so a single
  // instance covers every viewport.
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [showWalletPrompt, setShowWalletPrompt] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [showTransactionHistory, setShowTransactionHistory] = useState(false);
  const [showPaymentMethods, setShowPaymentMethods] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeCorridor, setActiveCorridor] = useState('USDT_INR');
  const [showOpenTradeModal, setShowOpenTradeModal] = useState(false);
  const [showMerchantQuoteModal, setShowMerchantQuoteModal] = useState(false);
  const [showMessageHistory, setShowMessageHistory] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrderPopup, setSelectedOrderPopup] = useState<Order | null>(
    null,
  );
  const [selectedMempoolOrder, setSelectedMempoolOrder] = useState<any | null>(
    null,
  );
  const [ratingModalData, setRatingModalData] = useState<{
    orderId: string;
    counterpartyName: string;
    counterpartyType: "user" | "merchant";
  } | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // UPI-pay popup state. Set when a sell order with upi_vpa is accepted
  // (auto-open), or when the merchant explicitly reopens via the order card's
  // "Pay via UPI" button after dismissing.
  const [upiPayOrder, setUpiPayOrder] = useState<Order | null>(null);
  const [isMerchantOnline, setIsMerchantOnline] = useState(true);
  const [collapsed, setCollapsed] = useState({
    activity: false,
    inProgress: false,
    completed: false,
    leaderboard: false,
  });
  const activityCollapsed = collapsed.activity;
  const inProgressCollapsed = collapsed.inProgress;
  const completedCollapsed = collapsed.completed;
  const leaderboardCollapsed = collapsed.leaderboard;
  const setActivityCollapsed = useCallback((v: boolean) => setCollapsed(p => ({ ...p, activity: v })), []);
  const setInProgressCollapsed = useCallback((v: boolean) => setCollapsed(p => ({ ...p, inProgress: v })), []);
  const setCompletedCollapsed = useCallback((v: boolean) => setCollapsed(p => ({ ...p, completed: v })), []);
  const setLeaderboardCollapsed = useCallback((v: boolean) => setCollapsed(p => ({ ...p, leaderboard: v })), []);
  const [mobileView, setMobileView] = useState<
    "home" | "orders" | "escrow" | "chat" | "history" | "marketplace"
  >("home");
  const [tabs, setTabs] = useState({
    market: "browse" as "browse" | "offers",
    leaderboard: "traders" as "traders" | "rated" | "reputation",
    history: "completed" as "completed" | "cancelled" | "stats",
  });
  const marketSubTab = tabs.market;
  const leaderboardTab = tabs.leaderboard;
  const historyTab = tabs.history;
  const setMarketSubTab = useCallback((v: "browse" | "offers") => setTabs(p => ({ ...p, market: v })), []);
  const setLeaderboardTab = useCallback((v: "traders" | "rated" | "reputation") => setTabs(p => ({ ...p, leaderboard: v })), []);
  const setHistoryTab = useCallback((v: "completed" | "cancelled" | "stats") => setTabs(p => ({ ...p, history: v })), []);
  const [openTradeForm, setOpenTradeForm] = useState({
    tradeType: "sell" as "buy" | "sell",
    cryptoAmount: "",
    paymentMethod: "bank" as "bank" | "cash",
    paymentMethodId: undefined as string | undefined,
    spreadPreference: "fastest" as "best" | "fastest" | "cheap",
    expiryMinutes: 15 as 15 | 90,
  });
  const [corridorForm, setCorridorForm] = useState({
    fromCurrency: "USDT",
    toCurrency: "AED",
    availableAmount: "",
    minAmount: "",
    maxAmount: "",
    rate: "3.67",
    premium: "0.25",
  });

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [isWideScreen, setIsWideScreen] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1536px)");
    setIsWideScreen(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsWideScreen(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const router = useRouter();
  const searchParams = useSearchParams();
  const solanaWallet = useSolanaWallet();
  const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === "true";
  const { isConnected: isPusherConnected } = usePusher();

  const embeddedWallet = (solanaWallet as any)?.embeddedWallet as
    | {
        state: "initializing" | "none" | "locked" | "unlocked";
        actorId: string | null;
        setActorId: (id: string | null) => void;
        unlockWallet: (password: string) => Promise<boolean>;
        migrateToPin?: (oldPassword: string, newPin: string) => Promise<boolean>;
        lockWallet: () => void;
        deleteWallet: () => void;
        setKeypairAndUnlock: (kp: any) => void;
      }
    | undefined;

  const {
    activeOffers,
    leaderboardData,
    inAppBalance,
    bigOrders,
    mempoolOrders,
    resolvedDisputes,
    effectiveBalance,
    setActiveOffers,
    setBigOrders,
    setMempoolOrders,
    setResolvedDisputes,
    fetchOrders,
    loadMoreOrders,
    hasMoreOrders,
    isLoadingMore,
    debouncedFetchOrders,
    fetchMempoolOrders,
    fetchActiveOffers,
    refreshBalance,
    refetchSingleOrder,
    afterMutationReconcile,
    dismissBigOrder,
  } = useOrderFetching({
    isMockMode,
    isPusherConnected,
    solanaUsdtBalance: solanaWallet.usdtBalance,
    solanaRefreshBalances: solanaWallet.refreshBalances,
  });

  // Login form / 2FA state live on `/merchant/login` now. This page only
  // needs the post-login handlers (logout, username prompt, profile sync).
  const {
    handleLogout,
    handleMerchantUsername,
    handleProfileUpdated,
  } = useDashboardAuth({
    isMockMode,
    solanaWallet,
    setShowWalletPrompt,
    setShowUsernameModal,
  });

  // When the merchant isn't authenticated, bounce to `/merchant/login` (the
  // canonical login URL). Any inbound query params (`?tab=register`,
  // `?reason=session_expired`, etc.) are forwarded so the login page can
  // render the right tab / surface the right error.
  useEffect(() => {
    if (isLoading) return;
    if (isLoggedIn) return;
    const qs = searchParams.toString();
    router.replace(`/merchant/login${qs ? `?${qs}` : ""}`);
  }, [isLoading, isLoggedIn, searchParams, router]);

  const { notifications, addNotification, markNotificationRead, markAllNotificationsRead, dismissStickyForOrder } =
    useNotifications(merchantId, isLoggedIn);

  // Hand the wallet context the current merchant id so its storage probe
  // targets the right per-merchant slot. Without this, a new merchant on a
  // device that once held another merchant's wallet would inherit the old
  // "Unlock Wallet" prompt for a blob they can't decrypt.
  useEffect(() => {
    if (!embeddedWallet) return;
    embeddedWallet.setActorId(merchantId ?? null);
  }, [embeddedWallet, merchantId]);

  // Presence heartbeat is mounted at the merchant layout level
  // (MerchantPresenceHeartbeat) so it fires across every merchant
  // route, not only the dashboard.

  const escrow = useEscrowOperations({
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
  const {
    showEscrowModal,
    escrowOrder,
    isLockingEscrow,
    escrowTxHash,
    escrowError,
    openEscrowModal,
    openEscrowModalForSell,
    executeLockEscrow,
    closeEscrowModal,
    showReleaseModal,
    releaseOrder,
    isReleasingEscrow,
    releaseTxHash,
    releaseError,
    openReleaseModal,
    executeRelease,
    closeReleaseModal,
    showCancelModal,
    cancelOrder,
    isCancellingEscrow,
    cancelTxHash,
    cancelError,
    openCancelModal,
    executeCancelEscrow,
    closeCancelModal,
    cancelOrderWithoutEscrow,
    cancellingOrderId,
  } = escrow;

  const dispute = useDisputeHandlers({
    solanaWallet,
    addNotification,
    playSound,
    toast,
    afterMutationReconcile,
    fetchOrders,
  });
  const {
    showDisputeModal,
    disputeReason,
    setDisputeReason,
    disputeDescription,
    setDisputeDescription,
    isSubmittingDispute,
    disputeInfo,
    setDisputeInfo,
    extensionRequests,
    setExtensionRequests,
    openDisputeModal,
    closeDisputeModal,
    submitDispute,
    fetchDisputeInfo,
    requestExtension,
    respondToExtension,
    respondToResolution,
    requestCancelOrder,
    respondToCancelRequest,
    isRequestingCancel,
  } = dispute;

  const { autoRefundEscrow } = useAutoRefund({
    solanaWallet,
    addNotification,
    playSound,
    debouncedFetchOrders,
  });

  const {
    orderConversations, totalUnread: chatTotalUnread, isLoadingConversations,
    fetchOrderConversations, scheduleFetch: scheduleConversationsFetch, clearUnreadForOrder,
    clearAllUnread,
  } = useMerchantConversations();

  // ── Order-based chat state ──────────────────────────────────────────
  const [activeOrderChat, setActiveOrderChat] = useState<{
    orderId: string; userName: string; orderNumber: string; orderType?: 'buy' | 'sell';
  } | null>(null);

  const onOpenOrderChat = useCallback((orderId: string, userName: string, orderNumber: string, orderType?: 'buy' | 'sell') => {
    clearUnreadForOrder(orderId);
    setActiveOrderChat({ orderId, userName, orderNumber, orderType });
  }, [clearUnreadForOrder]);

  const onCloseOrderChat = useCallback(() => {
    setActiveOrderChat(null);
    scheduleConversationsFetch();
  }, [scheduleConversationsFetch]);

  const { debouncedFetchConversations, fetchOrderConversationsRef } =
    useMerchantEffects({
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
      chatWindows: [],
      activeChatId,
      messagesEndRef,
      fetchOrderConversations,
      autoRefundEscrow,
    });

  const { chatWindows, openChat, closeChat, sendMessage, sendTypingIndicator } = useWebSocketChat({
    maxWindows: 10,
    actorType: "merchant",
    actorId: merchantId || undefined,
    onNewMessage: (
      chatId?: string,
      message?: { from: string; text: string },
    ) => {
      playSound("message");
      fetchOrderConversationsRef.current?.();
      if (message && message.from !== "me") {
        toast.showNewMessage("User", message.text?.substring(0, 80));
      }
    },
  });

  const handleOpenChat = useCallback(
    (order: Order) => {
      if (!merchantId) return;
      const userName = order.user || 'User';
      const orderNumber = order.dbOrder?.order_number || '';
      const orderType = order.dbOrder?.type;
      onOpenOrderChat(order.id, userName, orderNumber, orderType);
    },
    [merchantId, onOpenOrderChat],
  );

  const orderActions = useOrderActions({
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
    markingDone,
    acceptingOrderId,
    confirmingOrderId,
    isCreatingTrade,
    setIsCreatingTrade,
    createTradeError,
    setCreateTradeError,
    acceptOrder: rawAcceptOrder,
    acceptWithSaed,
    retryJoinEscrow,
    signToClaimOrder,
    signAndProceed,
    markFiatPaymentSent,
    markPaymentSent,
    completeOrder,
    confirmPayment,
    handleDirectOrderCreation: rawHandleDirectOrderCreation,
  } = orderActions;

  // Wrap acceptOrder to auto-open the UPI-pay modal for sell orders that
  // carry a scanned-VPA destination. Non-UPI orders are unaffected.
  const acceptOrder = useCallback(
    async (order: Order) => {
      const result = await rawAcceptOrder(order);
      // Order shape from PendingOrdersPanel sometimes uses snake_case keys
      // (db rows) and sometimes camelCase (UI-mapped). Probe both.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = order as any;
      const vpa: string | undefined = o.upi_vpa || o.upiVpa;
      if (vpa) setUpiPayOrder(order);
      return result;
    },
    [rawAcceptOrder],
  );

  // Any order card with a `upi_vpa` can reopen the modal after dismissal
  // by dispatching this DOM event. Avoids plumbing a callback through 6
  // layers of order-list components.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const order = (e as CustomEvent).detail as Order | null;
      if (order) setUpiPayOrder(order);
    };
    window.addEventListener("blip:open-upi-pay", onOpen);
    return () => window.removeEventListener("blip:open-upi-pay", onOpen);
  }, []);

  const markUpiOrderPaid = useCallback(async () => {
    if (!upiPayOrder) return;
    await markPaymentSent(upiPayOrder);
    setUpiPayOrder(null);
  }, [upiPayOrder, markPaymentSent]);

  const handleDirectOrderCreation = useCallback(
    (tradeType?: "buy" | "sell", priorityFee?: number, pair?: "usdt_aed" | "usdt_inr") => {
      rawHandleDirectOrderCreation(
        openTradeForm,
        setOpenTradeForm,
        tradeType,
        priorityFee,
        pair,
      );
    },
    [rawHandleDirectOrderCreation, openTradeForm, setOpenTradeForm],
  );

  const handleCancelOrder = useCallback(
    (order: Order) => {
      if (order.escrowTxHash) openCancelModal(order);
      else cancelOrderWithoutEscrow(order.id);
    },
    [openCancelModal, cancelOrderWithoutEscrow],
  );

  // Direct action handler for in-progress order cards
  const handleOrderAction = useCallback(
    (order: any, action: string) => {
      switch (action) {
        case "Lock Escrow":
          openEscrowModal(order);
          break;
        case "Send Fiat Payment":
          markFiatPaymentSent(order);
          break;
        case "Accept & Mine":
          signToClaimOrder(order);
          break;
        case "Confirm Receipt":
        case "Confirm & Release":
        case "Confirm Payment":
          confirmPayment(order.id);
          break;
        default:
          // For unknown actions, fall back to opening the detail popup
          setSelectedOrderPopup(order);
          break;
      }
    },
    [
      openEscrowModal,
      markFiatPaymentSent,
      signToClaimOrder,
      confirmPayment,
      setSelectedOrderPopup,
    ],
  );

  // Listen for compliance message notifications → auto-open order details
  useEffect(() => {
    const handler = (e: Event) => {
      const orderId = (e as CustomEvent).detail?.orderId;
      if (orderId) setSelectedOrderId(orderId);
    };
    window.addEventListener("open-order-chat", handler);
    return () => window.removeEventListener("open-order-chat", handler);
  }, []);

  // Fetch dispute info when viewing a chat for a disputed order
  // Derive narrow primitives so this effect doesn't re-run on every orders poll
  const activeChatOrderId = useMemo(() => {
    const activeChat = chatWindows.find(
      (c) => c.id === activeChatId || c.orderId === activeChatId,
    );
    return activeChat?.orderId ?? null;
  }, [activeChatId, chatWindows]);
  const activeChatOrderStatus = orders.find(
    (o) => o.id === activeChatOrderId,
  )?.status;

  useEffect(() => {
    if (activeChatOrderId) {
      if (activeChatOrderStatus === "disputed")
        fetchDisputeInfo(activeChatOrderId);
      else setDisputeInfo(null);
    }
  }, [activeChatOrderId, activeChatOrderStatus, fetchDisputeInfo]);

  const { handleCreateTrade } = useTradeCreation({
    solanaWallet,
    effectiveBalance,
    activeCorridor,
    openTradeForm,
    setOpenTradeForm,
    setShowOpenTradeModal,
    setIsCreatingTrade,
    setCreateTradeError,
    addNotification,
    playSound,
    refreshBalance,
  });

  useMerchantRealtimeEvents({
    debouncedFetchOrders,
    refetchSingleOrder,
    debouncedFetchConversations,
    refreshBalance,
    addNotification,
    playSound,
    toast,
    setExtensionRequests,
    dismissStickyForOrder,
  });

  // Rating submit handler (stable callback for MerchantModals)
  const handleRatingSubmit = useCallback(async (rating: number, review: string) => {
    if (!ratingModalData || !merchantId) return;
    const res = await fetchWithAuth("/api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: ratingModalData.orderId,
        rater_type: "merchant",
        rater_id: merchantId,
        rating,
        review_text: review,
      }),
    });
    if (res.ok) {
      toast.show({
        type: "complete",
        title: "Rating Submitted",
        message: `You rated ${ratingModalData.counterpartyName} ${rating} stars`,
      });
      fetchOrders();
    } else {
      const data = await res.json();
      throw new Error(data.error || "Failed to submit rating");
    }
  }, [ratingModalData, merchantId, toast, fetchOrders]);

  // Order filtering — helpers are defined inside each useMemo so that
  // merchantId is a proper dependency and filters update on user switch.
  const pendingOrders = useMemo(() => {
    const isSelfUnaccepted = (o: Order) => {
      const isSelf = o.isMyOrder || o.orderMerchantId === merchantId;
      if (!isSelf) return false;
      const dbUsername = o.dbOrder?.user?.username || "";
      const isPlaceholderUser =
        dbUsername.startsWith("open_order_") || dbUsername.startsWith("m2m_");
      if (!isPlaceholderUser) return false;
      const buyerMid = o.buyerMerchantId || o.dbOrder?.buyer_merchant_id;
      return !o.dbOrder?.accepted_at && !(buyerMid && buyerMid !== merchantId);
    };
    // Unclaimed escrowed orders (no accepted_at, no buyer_merchant_id) are still "pending" for claimers
    const isUnclaimedEscrow = (o: Order) => {
      const status = getEffectiveStatus(o);
      if (status !== "escrow") return false;
      const buyerMid = o.buyerMerchantId || o.dbOrder?.buyer_merchant_id;
      return !o.dbOrder?.accepted_at && !buyerMid;
    };
    return orders.filter((o) => {
      if (isOrderExpired(o)) return false;
      const status = getEffectiveStatus(o);
      if (status === "pending") return true;
      if (status === "escrow" && isSelfUnaccepted(o)) return true;
      if (isUnclaimedEscrow(o)) return true;
      return false;
    });
  }, [orders, merchantId]);

  const ongoingOrders = useMemo(() => {
    const hasMyEscrow = (o: Order) =>
      o.isMyOrder || o.myRole === "seller" || o.orderMerchantId === merchantId;
    const isSelfUnaccepted = (o: Order) => {
      const isSelf = o.isMyOrder || o.orderMerchantId === merchantId;
      if (!isSelf) return false;
      const dbUsername = o.dbOrder?.user?.username || "";
      const isPlaceholderUser =
        dbUsername.startsWith("open_order_") || dbUsername.startsWith("m2m_");
      if (!isPlaceholderUser) return false;
      const buyerMid = o.buyerMerchantId || o.dbOrder?.buyer_merchant_id;
      return !o.dbOrder?.accepted_at && !(buyerMid && buyerMid !== merchantId);
    };
    // Unclaimed escrowed orders go to Pending, not In Progress
    const isUnclaimedEscrow = (o: Order) => {
      const buyerMid = o.buyerMerchantId || o.dbOrder?.buyer_merchant_id;
      return !o.dbOrder?.accepted_at && !buyerMid;
    };
    return orders.filter((o) => {
      const status = getEffectiveStatus(o);
      if (status !== "escrow") return false;
      if (isSelfUnaccepted(o)) return false;
      if (isUnclaimedEscrow(o)) return false;
      if (hasMyEscrow(o)) return true;
      return !isOrderExpired(o);
    }).sort((a, b) => {
      // Newest first
      const aTime = new Date(a.dbOrder?.created_at || a.createdAt || 0).getTime();
      const bTime = new Date(b.dbOrder?.created_at || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
  }, [orders, merchantId]);

  const completedOrders = useMemo(
    () => orders.filter((o) => getEffectiveStatus(o) === "completed"),
    [orders],
  );
  const cancelledOrders = useMemo(() => {
    const hasMyEscrow = (o: Order) =>
      o.isMyOrder || o.myRole === "seller" || o.orderMerchantId === merchantId;
    return orders.filter((o) => {
      const status = getEffectiveStatus(o);
      return (
        status === "cancelled" ||
        status === "disputed" ||
        ((status === "active" || status === "pending") &&
          isOrderExpired(o)) ||
        (status === "escrow" && isOrderExpired(o) && !hasMyEscrow(o))
      );
    });
  }, [orders, merchantId]);

  // Earnings displayed under the "24h" badge on the dashboard. Only counts
  // orders that actually completed within the last 24 hours (the prior
  // implementation summed every completed order the merchant had ever done,
  // which contradicted the "24h" label). Falls back to the order's top-level
  // timestamp when dbOrder is unavailable. Defensive: any parsing failure
  // silently excludes that order rather than crashing the dashboard.
  const todayEarnings = useMemo(
    () => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return completedOrders.reduce((sum, o) => {
        const completedAt = o.dbOrder?.completed_at
          || (o.timestamp instanceof Date ? o.timestamp.toISOString() : undefined);
        if (!completedAt) return sum;
        const t = new Date(completedAt).getTime();
        if (!Number.isFinite(t) || t < cutoff) return sum;
        return sum + o.amount * TRADER_CUT_CONFIG.best;
      }, 0);
    },
    [completedOrders],
  );
  const totalTradedVolume = useMemo(
    () => completedOrders.reduce((sum, o) => sum + o.amount, 0),
    [completedOrders],
  );
  const pendingEarnings = useMemo(
    () =>
      ongoingOrders.reduce(
        (sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best,
        0,
      ),
    [ongoingOrders],
  );
  const totalUnread = chatTotalUnread;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center mx-auto mb-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
          <p className="text-sm text-foreground/40">Loading...</p>
        </div>
      </div>
    );
  }

  // Logged-out → the redirect effect above is sending the merchant to
  // `/merchant/login`. Show a spinner during the brief flash before the
  // route change commits, instead of mounting the LoginScreen here (which
  // would duplicate the login UI on two routes).
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // Old contact-based derived state removed — now order-based

  return (
    <OnboardingProvider merchantId={merchantId}>
    <div
      data-testid="merchant-dashboard"
      className="h-screen bg-background text-white flex flex-col overflow-hidden"
    >
      {/* Offset clears the sticky MerchantNavbar (h-12 mobile / h-[50px] desktop)
          so warning toasts don't overlap the bug-icon and avatar dropdown. */}
      <NotificationToastContainer position="top-right" topOffsetClass="top-14 lg:top-[58px]" />
      {tour.enabled && (
        <MerchantTour run={tour.isRunning} onComplete={tour.completeTour} />
      )}
      {/* Progressive setup — gated by NEXT_PUBLIC_ENABLE_MERCHANT_ONBOARDING.
          The setup checklist now lives inside NotificationsPanel as
          OnboardingSetupCard. The blocking overlay + bridged notification
          have been removed. The legacy MerchantTour tooltips still work
          on the same data-tour anchors if NEXT_PUBLIC_ENABLE_APP_TOUR is on. */}
      <OnboardingTour />
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[600px] h-[400px] bg-white/[0.02] rounded-full blur-[150px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-white/[0.01] rounded-full blur-[200px]" />
      </div>

      <MerchantNavbar
        activePage="dashboard"
        merchantInfo={merchantInfo}
        embeddedWalletState={embeddedWallet?.state}
        onLogout={handleLogout}
        onOpenProfile={() => setShowProfileModal(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenWallet={() => setShowWallet(true)}
        notificationCount={notifications.filter(n => !n.read).length}
        urgentNotificationCount={notifications.filter(n => !n.read && n.message.includes('act now to avoid auto-cancel')).length}
        onOpenNotifications={() => setShowNotifications(!showNotifications)}
        activeCorridor={activeCorridor}
        onCorridorChange={setActiveCorridor}
        rightActions={
          <>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowTransactionHistory(true)}
              className="p-2 rounded-lg transition-all bg-white/[0.03] hover:bg-card border border-white/[0.05]"
              title="Transaction History"
            >
              <History className="w-[18px] h-[18px] text-white/40" />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowPaymentMethods(true)}
              className="p-2 rounded-lg transition-all bg-white/[0.03] hover:bg-card border border-white/[0.05]"
              title="Payment Methods"
              data-tour="add-payment-method"
            >
              <Plus className="w-[18px] h-[18px] text-white/40" />
            </motion.button>
            <ConnectionIndicator isConnected={isPusherConnected} />
          </>
        }
      />

      {/* Mobile live-price ticker — only shown on the Home tab so other
          tabs (History, Chat, Orders, Escrow, Marketplace) aren't crowded
          by the corridor strip. The hook is shared, so re-mounting it on
          tab switch is cheap and doesn't trigger extra network traffic. */}
      {mobileView === "home" && <MobilePriceTicker />}

      <MerchantDesktopLayout
        isWideScreen={isWideScreen}
        pendingOrders={pendingOrders}
        ongoingOrders={ongoingOrders}
        completedOrders={completedOrders}
        cancelledOrders={cancelledOrders}
        mempoolOrders={mempoolOrders}
        leaderboardData={leaderboardData}
        merchantId={merchantId}
        merchantInfo={merchantInfo}
        effectiveBalance={effectiveBalance}
        todayEarnings={todayEarnings}
        isMerchantOnline={isMerchantOnline}
        setIsMerchantOnline={setIsMerchantOnline}
        walletStatus={
          // External Solana wallet connected, or embedded wallet unlocked → balance is real
          solanaWallet.connected || embeddedWallet?.state === 'unlocked'
            ? 'ok'
            // Embedded wallet exists and is locked → can be unlocked
            : embeddedWallet?.state === 'locked'
              ? 'locked'
              // Embedded wallet still booting → don't flash anything misleading
              : embeddedWallet?.state === 'initializing'
                ? 'ok'
                // No wallet at all (state === 'none' or undefined, and no external)
                : 'none'
        }
        // When the wallet exists but is locked, open the inline Unlock
        // modal instead of routing to /merchant/wallet — keeps the
        // merchant on the dashboard. For state === 'none' (no wallet
        // yet) we still send them to the wallet page where the
        // generate/import flow lives, since that flow is too heavy to
        // inline right now.
        onAddWallet={() => {
          if (embeddedWallet?.state === 'locked') {
            setShowUnlockModal(true);
          } else {
            router.push('/merchant/wallet');
          }
        }}
        activeCorridor={activeCorridor}
        onCorridorChange={setActiveCorridor}
        openTradeForm={openTradeForm}
        setOpenTradeForm={setOpenTradeForm}
        isCreatingTrade={isCreatingTrade}
        handleDirectOrderCreation={handleDirectOrderCreation}
        refreshBalance={refreshBalance}
        setSelectedOrderPopup={setSelectedOrderPopup}
        setSelectedMempoolOrder={setSelectedMempoolOrder}
        setSelectedOrderId={setSelectedOrderId}
        acceptOrder={acceptOrder}
        acceptingOrderId={acceptingOrderId}
        lockingEscrowOrderId={isLockingEscrow ? escrowOrder?.id ?? null : null}
        confirmingOrderId={confirmingOrderId}
        markingDone={markingDone}
        cancellingOrderId={cancellingOrderId}
        handleCancelOrder={handleCancelOrder}
        handleOpenChat={handleOpenChat}
        handleOrderAction={handleOrderAction}
        fetchOrders={fetchOrders}
        loadMoreOrders={loadMoreOrders}
        hasMoreOrders={hasMoreOrders}
        isLoadingMore={isLoadingMore}
        openDisputeModal={openDisputeModal}
        setRatingModalData={setRatingModalData}
        inProgressCollapsed={inProgressCollapsed}
        setInProgressCollapsed={setInProgressCollapsed}
        completedCollapsed={completedCollapsed}
        setCompletedCollapsed={setCompletedCollapsed}
        activityCollapsed={activityCollapsed}
        setActivityCollapsed={setActivityCollapsed}
        leaderboardCollapsed={leaderboardCollapsed}
        setLeaderboardCollapsed={setLeaderboardCollapsed}
        leaderboardTab={leaderboardTab}
        setLeaderboardTab={setLeaderboardTab}
        notifications={notifications}
        markNotificationRead={markNotificationRead}
        orderConversations={orderConversations}
        totalUnread={chatTotalUnread}
        isLoadingConversations={isLoadingConversations}
        activeOrderChat={activeOrderChat}
        onOpenOrderChat={onOpenOrderChat}
        onCloseOrderChat={onCloseOrderChat}
        onClearUnread={clearUnreadForOrder}
        onClearAllUnread={clearAllUnread}
        playSound={playSound}
        onOpenPaymentMethods={() => setShowPaymentMethods(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenSwap={() => setShowSwapModal(true)}
        onOpenSend={() => setShowSendModal(true)}
        onOpenDeposit={() => setShowDepositModal(true)}
      />

      {/* Page-level Swap / Send / Deposit modals — shared between desktop
          (StatusCard) and mobile (MobileHomeView) triggers so we don't
          mount two copies. Wallet adapter values come from useSolanaWallet
          at this scope; merchant page already consumes them above. */}
      <SwapModal
        isOpen={showSwapModal}
        onClose={() => setShowSwapModal(false)}
        walletAddress={solanaWallet?.walletAddress ?? null}
        signTransaction={(solanaWallet as { signTransaction?: never })?.signTransaction ?? null}
        solBalance={solanaWallet?.solBalance ?? null}
        usdtBalance={solanaWallet?.usdtBalance ?? null}
        usdcBalance={(solanaWallet as { usdcBalance?: number | null })?.usdcBalance ?? null}
        onSwapSuccess={() => solanaWallet?.refreshBalances?.()}
      />
      <SendModal
        isOpen={showSendModal}
        onClose={() => setShowSendModal(false)}
        walletAddress={solanaWallet?.walletAddress ?? null}
        signTransaction={(solanaWallet as { signTransaction?: never })?.signTransaction ?? null}
        solBalance={solanaWallet?.solBalance ?? null}
        usdtBalance={solanaWallet?.usdtBalance ?? null}
        usdcBalance={(solanaWallet as { usdcBalance?: number | null })?.usdcBalance ?? null}
        onSendSuccess={() => solanaWallet?.refreshBalances?.()}
      />
      <DepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        walletAddress={solanaWallet?.walletAddress ?? null}
      />
      <UnlockWalletModal
        isOpen={showUnlockModal}
        onClose={() => setShowUnlockModal(false)}
        unlockWallet={embeddedWallet?.unlockWallet ?? null}
        onMigrateToPin={embeddedWallet?.migrateToPin}
        onUnlocked={() => solanaWallet?.refreshBalances?.()}
      />

      <MerchantMobileContent
        mobileView={mobileView}
        setMobileView={setMobileView}
        pendingOrders={pendingOrders}
        ongoingOrders={ongoingOrders}
        completedOrders={completedOrders}
        cancelledOrders={cancelledOrders}
        bigOrders={bigOrders}
        acceptOrder={acceptOrder}
        acceptingOrderId={acceptingOrderId}
        handleOpenChat={handleOpenChat}
        dismissBigOrder={dismissBigOrder}
        handleCancelOrder={handleCancelOrder}
        cancellingOrderId={cancellingOrderId}
        setSelectedOrderPopup={setSelectedOrderPopup}
        markingDone={markingDone}
        openEscrowModal={openEscrowModal}
        markFiatPaymentSent={markFiatPaymentSent}
        confirmPayment={confirmPayment}
        openDisputeModal={openDisputeModal}
        openCancelModal={openCancelModal}
        merchantId={merchantId}
        orderConversations={orderConversations}
        chatTotalUnread={chatTotalUnread}
        isLoadingConversations={isLoadingConversations}
        activeOrderChat={activeOrderChat}
        onOpenOrderChat={onOpenOrderChat}
        onCloseOrderChat={onCloseOrderChat}
        onClearUnread={clearUnreadForOrder}
        onClearAllUnread={clearAllUnread}
        playSound={playSound}
        merchantInfo={merchantInfo}
        historyTab={historyTab}
        setHistoryTab={setHistoryTab}
        effectiveBalance={effectiveBalance}
        totalTradedVolume={totalTradedVolume}
        todayEarnings={todayEarnings}
        pendingEarnings={pendingEarnings}
        setShowAnalytics={setShowAnalytics}
        setShowWalletModal={setShowWalletModal}
        handleLogout={handleLogout}
        marketSubTab={marketSubTab}
        setMarketSubTab={setMarketSubTab}
        setOpenTradeForm={setOpenTradeForm}
        setShowOpenTradeModal={setShowOpenTradeModal}
        setShowCreateModal={setShowCreateModal}
        openTradeForm={openTradeForm}
        isCreatingTrade={isCreatingTrade}
        onCreateTrade={handleCreateTrade}
        onShowWalletModal={() => setShowWalletModal(true)}
        onOpenWallet={() => setShowWallet(true)}
        embeddedWalletState={embeddedWallet?.state}
        activeCorridor={activeCorridor}
        onCorridorChange={setActiveCorridor}
        totalUnread={totalUnread}
        onOpenPaymentMethods={() => setShowPaymentMethods(true)}
      />

      {/* Mobile Notifications Overlay */}
      {showNotifications && (
        <div className="lg:hidden fixed inset-0 z-[55]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNotifications(false)} />
          <div className="absolute inset-0 bg-card-solid flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-section-divider">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-foreground/40" />
                <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
                {notifications.filter(n => !n.read).length > 0 && (
                  <span className="text-[10px] bg-primary text-background font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {notifications.filter(n => !n.read).length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {notifications.some(n => !n.read) && (
                  <button
                    onClick={markAllNotificationsRead}
                    className="text-[11px] font-semibold text-primary px-2 py-1 rounded-md hover:bg-primary/10 transition-colors"
                  >
                    Mark all read
                  </button>
                )}
                <button onClick={() => setShowNotifications(false)} className="p-1.5 rounded-lg hover:bg-foreground/[0.06] transition-colors">
                  <X className="w-5 h-5 text-foreground/40" />
                </button>
              </div>
            </div>
            {/* List */}
            <div className="flex-1 overflow-y-auto p-2">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-foreground/20 p-8">
                  <Bell className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">No notifications</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {notifications.map((n) => {
                    const iconBg =
                      n.type === 'complete' ? 'bg-emerald-500/10' :
                      n.type === 'escrow' ? 'bg-primary/10' :
                      n.type === 'payment' ? 'bg-blue-500/10' :
                      n.type === 'dispute' ? 'bg-red-500/10' :
                      n.type === 'order' ? 'bg-primary/10' :
                      'bg-foreground/[0.04]';
                    const iconColor =
                      n.type === 'complete' ? 'text-emerald-400' :
                      n.type === 'escrow' ? 'text-primary' :
                      n.type === 'payment' ? 'text-blue-400' :
                      n.type === 'dispute' ? 'text-red-400' :
                      n.type === 'order' ? 'text-primary' :
                      'text-foreground/40';
                    const secAgo = Math.floor((Date.now() - n.timestamp) / 1000);
                    const relTime = secAgo < 60 ? 'Just now' : secAgo < 3600 ? `${Math.floor(secAgo / 60)}m ago` : secAgo < 86400 ? `${Math.floor(secAgo / 3600)}h ago` : `${Math.floor(secAgo / 86400)}d ago`;

                    return (
                      <button
                        key={n.id}
                        onClick={() => {
                          markNotificationRead(n.id);
                          // If the notification is tied to an order, open its
                          // quick-view popup so the merchant lands on the
                          // relevant info instead of hunting for the order.
                          if (n.orderId) {
                            const target = orders.find((o) => o.id === n.orderId);
                            if (target) setSelectedOrderPopup(target);
                          }
                          setShowNotifications(false);
                        }}
                        className={`w-full text-left p-3 rounded-xl border transition-colors ${
                          n.read
                            ? 'opacity-50 border-transparent'
                            : 'bg-foreground/[0.02] border-foreground/[0.06] hover:border-foreground/[0.10]'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center shrink-0 mt-0.5`}>
                            <div className={`w-2 h-2 rounded-full ${iconColor.replace('text-', 'bg-')}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-text-primary leading-snug">{n.message}</p>
                            <p className="text-[11px] text-text-secondary mt-1">{relTime}</p>
                          </div>
                          {!n.read && (
                            <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <MerchantModals
        merchantId={merchantId}
        orders={orders}
        showDisputeModal={showDisputeModal}
        disputeReason={disputeReason}
        setDisputeReason={setDisputeReason}
        disputeDescription={disputeDescription}
        setDisputeDescription={setDisputeDescription}
        isSubmittingDispute={isSubmittingDispute}
        closeDisputeModal={closeDisputeModal}
        submitDispute={submitDispute}
        showEscrowModal={showEscrowModal}
        escrowOrder={escrowOrder}
        isLockingEscrow={isLockingEscrow}
        escrowTxHash={escrowTxHash}
        escrowError={escrowError}
        effectiveBalance={effectiveBalance}
        closeEscrowModal={closeEscrowModal}
        executeLockEscrow={executeLockEscrow}
        showCancelModal={showCancelModal}
        cancelOrder={cancelOrder}
        isCancellingEscrow={isCancellingEscrow}
        cancelTxHash={cancelTxHash}
        cancelError={cancelError}
        closeCancelModal={closeCancelModal}
        executeCancelEscrow={executeCancelEscrow}
        showWalletPrompt={showWalletPrompt}
        setShowWalletPrompt={setShowWalletPrompt}
        solanaWalletConnected={solanaWallet.connected}
        showWalletModal={showWalletModal}
        setShowWalletModal={setShowWalletModal}
        solanaWalletAddress={solanaWallet.walletAddress}
        showAnalytics={showAnalytics}
        setShowAnalytics={setShowAnalytics}
        showUsernameModal={showUsernameModal}
        handleMerchantUsername={handleMerchantUsername}
        showProfileModal={showProfileModal}
        setShowProfileModal={setShowProfileModal}
        merchantInfo={merchantInfo}
        handleProfileUpdated={handleProfileUpdated}
        showTransactionHistory={showTransactionHistory}
        setShowTransactionHistory={setShowTransactionHistory}
        showPaymentMethods={showPaymentMethods}
        setShowPaymentMethods={setShowPaymentMethods}
        ratingModalData={ratingModalData}
        setRatingModalData={setRatingModalData}
        onRatingSubmit={handleRatingSubmit}
        showMerchantQuoteModal={showMerchantQuoteModal}
        setShowMerchantQuoteModal={setShowMerchantQuoteModal}
        selectedMempoolOrder={selectedMempoolOrder}
        setSelectedMempoolOrder={setSelectedMempoolOrder}
        showCreateModal={showCreateModal}
        setShowCreateModal={setShowCreateModal}
        corridorForm={corridorForm}
        setCorridorForm={setCorridorForm}
        solanaWalletAddressForCorridor={solanaWallet.walletAddress}
        refreshBalance={refreshBalance}
        fetchActiveOffers={fetchActiveOffers}
        showOpenTradeModal={showOpenTradeModal}
        setShowOpenTradeModal={setShowOpenTradeModal}
        openTradeForm={openTradeForm}
        setOpenTradeForm={setOpenTradeForm}
        isCreatingTrade={isCreatingTrade}
        createTradeError={createTradeError}
        setCreateTradeError={setCreateTradeError}
        handleCreateTrade={handleCreateTrade}
        activeCorridor={activeCorridor}
        onCorridorChange={setActiveCorridor}
        selectedOrderPopup={selectedOrderPopup}
        setSelectedOrderPopup={setSelectedOrderPopup}
        markingDone={markingDone}
        acceptingOrderId={acceptingOrderId}
        confirmingOrderId={confirmingOrderId}
        cancellingOrderId={cancellingOrderId}
        isRequestingCancel={isRequestingCancel}
        acceptOrder={acceptOrder}
        openEscrowModal={openEscrowModal}
        markFiatPaymentSent={markFiatPaymentSent}
        confirmPayment={confirmPayment}
        cancelOrderWithoutEscrow={cancelOrderWithoutEscrow}
        respondToCancelRequest={respondToCancelRequest}
        handleOpenChat={handleOpenChat}
        selectedOrderId={selectedOrderId}
        setSelectedOrderId={setSelectedOrderId}
        openChat={openChat}
        setActiveChatId={setActiveChatId}
        openDisputeModal={openDisputeModal}
        requestCancelOrder={requestCancelOrder}
        openCancelModal={openCancelModal}
        fetchOrders={fetchOrders}
        toast={toast}
        showMessageHistory={showMessageHistory}
        setShowMessageHistory={setShowMessageHistory}
        orderConversations={orderConversations}
        chatTotalUnread={chatTotalUnread}
        isLoadingConversations={isLoadingConversations}
        activeOrderChat={activeOrderChat}
        onOpenOrderChat={onOpenOrderChat}
        onCloseOrderChat={onCloseOrderChat}
        onClearUnread={clearUnreadForOrder}
        onClearAllUnread={clearAllUnread}
        playSound={playSound}
      />

      <MerchantSettingsOverlay
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onOpenWallet={() => { setShowSettings(false); setShowWallet(true); }}
      />

      <MerchantWalletOverlay
        open={showWallet}
        onClose={() => setShowWallet(false)}
        onOpenSettings={() => { setShowWallet(false); setShowSettings(true); }}
      />

      {/* UPI-pay modal: auto-opens for a sell order carrying upi_vpa, and
          can be reopened later via the order card's "Pay via UPI" button. */}
      <MerchantUpiPayModal
        order={(upiPayOrder as unknown as { id: string }) ?? { id: "" }}
        open={!!upiPayOrder}
        onClose={() => setUpiPayOrder(null)}
        onMarkPaid={markUpiOrderPaid}
      />

      <PushPermissionPrompt authed={!!merchantId} />
    </div>
    </OnboardingProvider>
  );
}
