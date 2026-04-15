"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { LoginScreen } from "@/components/merchant/LoginScreen";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order } from "@/types/merchant";
import {
  getEffectiveStatus,
  isOrderExpired,
  TRADER_CUT_CONFIG,
} from "@/lib/orders/mappers";
import { useNotifications } from "@/hooks/useNotifications";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
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
import { useSolanaWallet } from "@/context/SolanaWalletContext";
import { MerchantModals } from "@/components/merchant/MerchantModals";
import { MerchantDesktopLayout } from "@/components/merchant/MerchantDesktopLayout";
import { MerchantTour } from "@/components/merchant/MerchantTour";
import { useMerchantTour } from "@/hooks/useMerchantTour";
import { MerchantMobileContent } from "@/components/merchant/MerchantMobileContent";

export default function MerchantDashboard() {
  const { playSound } = useSounds();
  const toast = useToast();
  const orders = useMerchantStore((s) => s.orders);
  const merchantId = useMerchantStore((s) => s.merchantId);
  const merchantInfo = useMerchantStore((s) => s.merchantInfo);
  const isLoggedIn = useMerchantStore((s) => s.isLoggedIn);
  const isLoading = useMerchantStore((s) => s.isLoading);

  // Onboarding tour — env-controlled, shows once per merchant on first login
  const tour = useMerchantTour(merchantId);

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showWalletPrompt, setShowWalletPrompt] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
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

  const solanaWallet = useSolanaWallet();
  const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === "true";
  const { isConnected: isPusherConnected } = usePusher();

  const embeddedWallet = (solanaWallet as any)?.embeddedWallet as
    | {
        state: "none" | "locked" | "unlocked";
        unlockWallet: (password: string) => Promise<boolean>;
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

  const {
    loginForm,
    setLoginForm,
    registerForm,
    setRegisterForm,
    authTab,
    setAuthTab,
    loginError,
    setLoginError,
    isLoggingIn,
    isRegistering,
    unverifiedMerchantId,
    isResendingVerification,
    resendVerificationEmail,
    pending2FA,
    totpCode,
    setTotpCode,
    isVerifying2FA,
    handle2FAVerify,
    cancel2FA,
    handleLogin,
    handleRegister,
    handleLogout,
    handleMerchantUsername,
    handleProfileUpdated,
  } = useDashboardAuth({
    isMockMode,
    solanaWallet,
    setShowWalletPrompt,
    setShowUsernameModal,
  });

  const { notifications, addNotification, markNotificationRead } =
    useNotifications(merchantId, isLoggedIn);

  // Send presence heartbeat so other parties see this merchant as online
  usePresenceHeartbeat(!!merchantId && isLoggedIn);

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
    acceptOrder,
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

  // Reference-stability helper: returns the same array instance when the
  // passed slice is structurally identical to the previous call. Prevents
  // downstream `useMemo`s in CompletedOrdersPanel / InProgressPanel from
  // re-running on every parent fetch cycle when only other slices changed
  // (the ongoing / completed sets often don't move between refreshes, but
  // the containing `orders` state always gets a new array reference).
  const stabilizerRefs = useRef<
    Record<"pending" | "ongoing" | "completed" | "cancelled", Order[]>
  >({ pending: [], ongoing: [], completed: [], cancelled: [] });
  const stabilize = useCallback(
    (key: "pending" | "ongoing" | "completed" | "cancelled", next: Order[]) => {
      const prev = stabilizerRefs.current[key];
      if (prev.length === next.length) {
        let same = true;
        for (let i = 0; i < next.length; i++) {
          const p = prev[i];
          const n = next[i];
          if (
            p.id !== n.id ||
            p.minimalStatus !== n.minimalStatus ||
            p.status !== n.status ||
            p.orderVersion !== n.orderVersion ||
            p.expiresIn !== n.expiresIn
          ) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      stabilizerRefs.current[key] = next;
      return next;
    },
    [],
  );

  // Order filtering — ONE single pass over the orders list producing all
  // four slices (pending / ongoing / completed / cancelled). Semantics are
  // byte-identical to the four separate filters that lived here before; the
  // consolidation avoids 3× list traversal + repeated helper evaluation and
  // also caches the parsed created_at millisecond once (used by the ongoing
  // sort) instead of re-parsing a Date string per sort comparison.
  const { pendingOrders, ongoingOrders, completedOrders, cancelledOrders } =
    useMemo(() => {
      const pending: Order[] = [];
      const ongoing: Order[] = [];
      const ongoingMs: number[] = [];
      const completed: Order[] = [];
      const cancelled: Order[] = [];

      const hasMyEscrow = (o: Order) =>
        o.isMyOrder || o.myRole === "seller" || o.orderMerchantId === merchantId;

      const isSelfUnaccepted = (o: Order) => {
        const isSelf = o.isMyOrder || o.orderMerchantId === merchantId;
        if (!isSelf) return false;
        const dbUsername = o.dbOrder?.user?.username || "";
        const isPlaceholderUser =
          dbUsername.startsWith("open_order_") ||
          dbUsername.startsWith("m2m_");
        if (!isPlaceholderUser) return false;
        const buyerMid = o.buyerMerchantId || o.dbOrder?.buyer_merchant_id;
        return (
          !o.dbOrder?.accepted_at && !(buyerMid && buyerMid !== merchantId)
        );
      };

      for (const o of orders) {
        const status = getEffectiveStatus(o);
        const expired = isOrderExpired(o);
        const selfUnaccepted =
          status === "escrow" ? isSelfUnaccepted(o) : false;
        const buyerMid = o.buyerMerchantId || o.dbOrder?.buyer_merchant_id;
        const unclaimedEscrow =
          status === "escrow" &&
          !o.dbOrder?.accepted_at &&
          !buyerMid;

        // ── Pending ────────────────────────────────────────────────
        // Same predicate as the previous standalone filter:
        //   !expired && (status === "pending" || (escrow && selfUnaccepted) || unclaimedEscrow)
        if (!expired) {
          if (
            status === "pending" ||
            (status === "escrow" && selfUnaccepted) ||
            unclaimedEscrow
          ) {
            pending.push(o);
          }
        }

        // ── Ongoing (In Progress) ──────────────────────────────────
        // Previous predicate:
        //   status === "escrow" && !selfUnaccepted && !unclaimedEscrow &&
        //     (hasMyEscrow(o) || !expired)
        if (
          status === "escrow" &&
          !selfUnaccepted &&
          !unclaimedEscrow &&
          (hasMyEscrow(o) || !expired)
        ) {
          ongoing.push(o);
          // Cache created_at parse so the sort below doesn't reparse per compare.
          const raw = o.dbOrder?.created_at || o.createdAt || 0;
          ongoingMs.push(
            typeof raw === "number" ? raw : new Date(raw).getTime(),
          );
        }

        // ── Completed ──────────────────────────────────────────────
        if (status === "completed") {
          completed.push(o);
        }

        // ── Cancelled / Disputed / Expired-without-escrow ─────────
        // Previous predicate:
        //   status === "cancelled" || status === "disputed" ||
        //   ((status === "active" || status === "pending") && expired) ||
        //   (status === "escrow" && expired && !hasMyEscrow(o))
        if (
          status === "cancelled" ||
          status === "disputed" ||
          ((status === "active" || status === "pending") && expired) ||
          (status === "escrow" && expired && !hasMyEscrow(o))
        ) {
          cancelled.push(o);
        }
      }

      // Newest-first sort for ongoing — stable ordering by cached ms.
      let ongoingSorted: Order[] = ongoing;
      if (ongoing.length > 1) {
        const indices = ongoing.map((_, i) => i);
        indices.sort((a, b) => ongoingMs[b] - ongoingMs[a]);
        const sorted: Order[] = [];
        for (const i of indices) sorted.push(ongoing[i]);
        ongoingSorted = sorted;
      }

      // Pass each slice through the referential-stability check so that
      // slices which didn't actually change between fetches keep the same
      // array reference — downstream `useMemo`s in the panels therefore
      // stay memoized.
      return {
        pendingOrders: stabilize("pending", pending),
        ongoingOrders: stabilize("ongoing", ongoingSorted),
        completedOrders: stabilize("completed", completed),
        cancelledOrders: stabilize("cancelled", cancelled),
      };
    }, [orders, merchantId, stabilize]);

  const todayEarnings = useMemo(
    () =>
      completedOrders.reduce(
        (sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best,
        0,
      ),
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

  if (!isLoggedIn) {
    // 2FA challenge screen
    if (pending2FA) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              </div>
              <h1 className="text-xl font-bold text-white">Two-Factor Authentication</h1>
              <p className="text-sm text-white/40 mt-1">Enter the 6-digit code from your authenticator app</p>
            </div>

            {loginError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                {loginError}
              </div>
            )}

            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-4 text-2xl text-white text-center font-mono tracking-[0.4em] placeholder:text-white/10 outline-none focus:border-primary/30 transition-colors"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && totpCode.length === 6) handle2FAVerify(); }}
            />

            <button
              onClick={handle2FAVerify}
              disabled={isVerifying2FA || totpCode.length !== 6}
              className="w-full py-3.5 rounded-xl bg-primary/15 border border-primary/25 text-primary font-semibold text-sm hover:bg-primary/25 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {isVerifying2FA ? (
                <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Verifying...</>
              ) : 'Verify & Login'}
            </button>

            <button
              onClick={cancel2FA}
              className="w-full py-2.5 text-sm text-white/30 hover:text-foreground/50 transition-colors"
            >
              Back to login
            </button>
          </div>
        </div>
      );
    }

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
        isAuthenticating={false}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onResendVerification={resendVerificationEmail}
        isResendingVerification={isResendingVerification}
      />
    );
  }

  // Old contact-based derived state removed — now order-based

  return (
    <div
      data-testid="merchant-dashboard"
      className="h-screen bg-background text-white flex flex-col overflow-hidden"
    >
      <NotificationToastContainer position="top-right" />
      {tour.enabled && (
        <MerchantTour run={tour.isRunning} onComplete={tour.completeTour} />
      )}
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
        notificationCount={notifications.filter(n => !n.read).length}
        onOpenNotifications={() => setShowNotifications(!showNotifications)}
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
            >
              <Plus className="w-[18px] h-[18px] text-white/40" />
            </motion.button>
            <ConnectionIndicator isConnected={isPusherConnected} />
          </>
        }
      />

      {/* Mobile Stats Bar */}
      <div className="md:hidden flex items-center gap-1.5 px-3 py-1.5 bg-foreground/[0.02] border-b border-foreground/[0.04]">
        <button
          onClick={() => setShowWalletModal(true)}
          className="flex items-center gap-1 px-2 py-1 bg-foreground/[0.04] rounded-md border border-foreground/[0.08] shrink-0"
        >
          <span className="text-[11px] font-mono text-foreground/70">
            {effectiveBalance !== null
              ? `${effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
              : "—"}
          </span>
        </button>
        <div className="flex items-center gap-1 px-2 py-1 bg-foreground/[0.03] rounded-md shrink-0">
          <span className="text-[10px] font-mono text-foreground/40">
            ${totalTradedVolume.toLocaleString()}
          </span>
        </div>
        <div className="flex-1" />
      </div>

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
        playSound={playSound}
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
        totalUnread={totalUnread}
      />

      {/* Mobile Notifications Overlay */}
      {showNotifications && (
        <div className="md:hidden fixed inset-0 z-[55]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNotifications(false)} />
          <div className="absolute inset-0 bg-card-solid flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-section-divider">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-foreground/40" />
                <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
                {notifications.filter(n => !n.read).length > 0 && (
                  <span className="text-[10px] bg-primary text-white font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {notifications.filter(n => !n.read).length}
                  </span>
                )}
              </div>
              <button onClick={() => setShowNotifications(false)} className="p-1.5 rounded-lg hover:bg-foreground/[0.06] transition-colors">
                <X className="w-5 h-5 text-foreground/40" />
              </button>
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
                        onClick={() => { markNotificationRead(n.id); }}
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
        playSound={playSound}
      />


    </div>
  );
}
