"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Plus,
  Loader2,
  History,
} from "lucide-react";
import dynamic from "next/dynamic";
import { usePusher } from "@/context/PusherContext";
import { useSounds } from "@/hooks/useSounds";
import { useWebSocketChat } from "@/hooks/useWebSocketChat";
import { useDirectChat } from "@/hooks/useDirectChat";
import { DirectChatView } from "@/components/merchant/DirectChatView";
import PWAInstallBanner from "@/components/PWAInstallBanner";
import { NotificationToastContainer, useToast, ConnectionIndicator } from "@/components/NotificationToast";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
const OrderDetailsPanel = dynamic(() => import("@/components/merchant/OrderDetailsPanel").then(m => ({ default: m.OrderDetailsPanel })), { ssr: false });
const MerchantProfileModal = dynamic(() => import("@/components/merchant/MerchantProfileModal").then(m => ({ default: m.MerchantProfileModal })), { ssr: false });
const TransactionHistoryModal = dynamic(() => import("@/components/merchant/TransactionHistoryModal").then(m => ({ default: m.TransactionHistoryModal })), { ssr: false });
const PaymentMethodModal = dynamic(() => import("@/components/merchant/PaymentMethodModal").then(m => ({ default: m.PaymentMethodModal })), { ssr: false });
const RatingModal = dynamic(() => import("@/components/RatingModal").then(m => ({ default: m.RatingModal })), { ssr: false });
const MerchantQuoteModal = dynamic(() => import("@/components/mempool/MerchantQuoteModal").then(m => ({ default: m.MerchantQuoteModal })), { ssr: false });
const OrderInspector = dynamic(() => import("@/components/mempool/OrderInspector").then(m => ({ default: m.OrderInspector })), { ssr: false });
import { DashboardWidgets } from "@/components/merchant/DashboardWidgets";
import { ConfigPanel } from "@/components/merchant/ConfigPanel";
import { PendingOrdersPanel } from "@/components/merchant/PendingOrdersPanel";
import { LeaderboardPanel } from "@/components/merchant/LeaderboardPanel";
import { InProgressPanel } from "@/components/merchant/InProgressPanel";
import { ActivityPanel } from "@/components/merchant/ActivityPanel";
import { CompletedOrdersPanel } from "@/components/merchant/CompletedOrdersPanel";
import { MerchantNavbar } from "@/components/merchant/MerchantNavbar";
import { NotificationsPanel } from "@/components/merchant/NotificationsPanel";
import { MobileOrdersView } from "@/components/merchant/MobileOrdersView";
import { MobileEscrowView } from "@/components/merchant/MobileEscrowView";
import { MobileChatView } from "@/components/merchant/MobileChatView";
import { MobileHistoryView } from "@/components/merchant/MobileHistoryView";
import { MobileMarketplaceView } from "@/components/merchant/MobileMarketplaceView";
import { MobileBottomNav } from "@/components/merchant/MobileBottomNav";
const CorridorCreateModal = dynamic(() => import("@/components/merchant/CorridorCreateModal").then(m => ({ default: m.CorridorCreateModal })), { ssr: false });
const TradeFormModal = dynamic(() => import("@/components/merchant/TradeFormModal").then(m => ({ default: m.TradeFormModal })), { ssr: false });
const OrderQuickView = dynamic(() => import("@/components/merchant/OrderQuickView").then(m => ({ default: m.OrderQuickView })), { ssr: false });
import { LoginScreen } from "@/components/merchant/LoginScreen";
const EscrowLockModal = dynamic(() => import("@/components/merchant/EscrowLockModal").then(m => ({ default: m.EscrowLockModal })), { ssr: false });
// EscrowReleaseModal removed — confirm payment now uses showConfirm dialog + automatic escrow release
const EscrowCancelModal = dynamic(() => import("@/components/merchant/EscrowCancelModal").then(m => ({ default: m.EscrowCancelModal })), { ssr: false });
const DisputeModal = dynamic(() => import("@/components/merchant/DisputeModal").then(m => ({ default: m.DisputeModal })), { ssr: false });
const WalletPromptModal = dynamic(() => import("@/components/merchant/WalletPromptModal").then(m => ({ default: m.WalletPromptModal })), { ssr: false });
const AnalyticsModal = dynamic(() => import("@/components/merchant/AnalyticsModal").then(m => ({ default: m.AnalyticsModal })), { ssr: false });
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order } from "@/types/merchant";
import { getEffectiveStatus, isOrderExpired, TRADER_CUT_CONFIG } from "@/lib/orders/mappers";
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
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { useSolanaWallet } from '@/context/SolanaWalletContext';

const MerchantWalletModal = dynamic(() => import("@/components/MerchantWalletModal"), { ssr: false });
const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';
const UsernameModal = dynamic(() => import("@/components/UsernameModal"), { ssr: false });

export default function MerchantDashboard() {
  const { playSound } = useSounds();
  const toast = useToast();
  const orders = useMerchantStore(s => s.orders);
  const merchantId = useMerchantStore(s => s.merchantId);
  const merchantInfo = useMerchantStore(s => s.merchantInfo);
  const isLoggedIn = useMerchantStore(s => s.isLoggedIn);
  const isLoading = useMerchantStore(s => s.isLoading);

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showWalletPrompt, setShowWalletPrompt] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showTransactionHistory, setShowTransactionHistory] = useState(false);
  const [showPaymentMethods, setShowPaymentMethods] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOpenTradeModal, setShowOpenTradeModal] = useState(false);
  const [showMerchantQuoteModal, setShowMerchantQuoteModal] = useState(false);
  const [showMessageHistory, setShowMessageHistory] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrderPopup, setSelectedOrderPopup] = useState<Order | null>(null);
  const [selectedMempoolOrder, setSelectedMempoolOrder] = useState<any | null>(null);
  const [ratingModalData, setRatingModalData] = useState<{
    orderId: string; counterpartyName: string; counterpartyType: 'user' | 'merchant';
  } | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isMerchantOnline, setIsMerchantOnline] = useState(true);
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [inProgressCollapsed, setInProgressCollapsed] = useState(false);
  const [completedCollapsed, setCompletedCollapsed] = useState(false);
  const [leaderboardCollapsed, setLeaderboardCollapsed] = useState(false);
  const [mobileView, setMobileView] = useState<'orders' | 'escrow' | 'chat' | 'history' | 'marketplace'>('orders');
  const [marketSubTab, setMarketSubTab] = useState<'browse' | 'offers'>('browse');
  const [leaderboardTab, setLeaderboardTab] = useState<'traders' | 'rated' | 'reputation'>('traders');
  const [historyTab, setHistoryTab] = useState<'completed' | 'cancelled' | 'stats'>('completed');
  const [openTradeForm, setOpenTradeForm] = useState({
    tradeType: "sell" as "buy" | "sell",
    cryptoAmount: "",
    paymentMethod: "bank" as "bank" | "cash",
    spreadPreference: "fastest" as "best" | "fastest" | "cheap",
    expiryMinutes: 15 as 15 | 90,
  });
  const [corridorForm, setCorridorForm] = useState({
    fromCurrency: "USDT", toCurrency: "AED", availableAmount: "",
    minAmount: "", maxAmount: "", rate: "3.67", premium: "0.25",
  });

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [isWideScreen, setIsWideScreen] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1536px)');
    setIsWideScreen(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsWideScreen(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const solanaWallet = useSolanaWallet();
  const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';
  const { isConnected: isPusherConnected } = usePusher();

  const embeddedWallet = (solanaWallet as any)?.embeddedWallet as {
    state: 'none' | 'locked' | 'unlocked';
    unlockWallet: (password: string) => Promise<boolean>;
    lockWallet: () => void; deleteWallet: () => void;
    setKeypairAndUnlock: (kp: any) => void;
  } | undefined;

  const {
    activeOffers, leaderboardData, inAppBalance, bigOrders, mempoolOrders, resolvedDisputes,
    effectiveBalance, setActiveOffers, setBigOrders, setMempoolOrders, setResolvedDisputes,
    fetchOrders, debouncedFetchOrders, fetchMempoolOrders, fetchActiveOffers,
    refreshBalance, refetchSingleOrder, afterMutationReconcile, dismissBigOrder,
  } = useOrderFetching({ isMockMode, isPusherConnected, solanaUsdtBalance: solanaWallet.usdtBalance, solanaRefreshBalances: solanaWallet.refreshBalances });

  const {
    loginForm, setLoginForm, registerForm, setRegisterForm,
    authTab, setAuthTab, loginError, setLoginError,
    isLoggingIn, isRegistering,
    handleLogin, handleRegister, handleLogout,
    handleMerchantUsername, handleProfileUpdated,
  } = useDashboardAuth({ isMockMode, solanaWallet, setShowWalletPrompt, setShowUsernameModal });

  const { notifications, addNotification, markNotificationRead } = useNotifications(merchantId, isLoggedIn);

  const escrow = useEscrowOperations({
    solanaWallet, effectiveBalance, inAppBalance, addNotification, playSound,
    afterMutationReconcile, fetchOrders, refreshBalance, setShowWalletModal, setRatingModalData,
  });
  const {
    showEscrowModal, escrowOrder, isLockingEscrow, escrowTxHash, escrowError,
    openEscrowModal, openEscrowModalForSell, executeLockEscrow, closeEscrowModal,
    showReleaseModal, releaseOrder, isReleasingEscrow, releaseTxHash, releaseError,
    openReleaseModal, executeRelease, closeReleaseModal,
    showCancelModal, cancelOrder, isCancellingEscrow, cancelTxHash, cancelError,
    openCancelModal, executeCancelEscrow, closeCancelModal,
    cancelOrderWithoutEscrow, cancellingOrderId,
  } = escrow;

  const dispute = useDisputeHandlers({
    solanaWallet, addNotification, playSound, toast, afterMutationReconcile, fetchOrders,
  });
  const {
    showDisputeModal, disputeReason, setDisputeReason,
    disputeDescription, setDisputeDescription, isSubmittingDispute,
    disputeInfo, setDisputeInfo, extensionRequests, setExtensionRequests,
    openDisputeModal, closeDisputeModal, submitDispute, fetchDisputeInfo,
    requestExtension, respondToExtension, respondToResolution,
    requestCancelOrder, respondToCancelRequest, isRequestingCancel,
  } = dispute;

  const { autoRefundEscrow } = useAutoRefund({ solanaWallet, addNotification, playSound, debouncedFetchOrders });

  const { fetchOrderConversations } = useMerchantConversations();

  const { debouncedFetchConversations, fetchOrderConversationsRef } = useMerchantEffects({
    isMockMode, solanaWallet, merchantInfo, isLoggedIn, orders,
    fetchOrders, debouncedFetchOrders, refetchSingleOrder, refreshBalance, playSound, addNotification,
    chatWindows: [], activeChatId, messagesEndRef, fetchOrderConversations, autoRefundEscrow,
  });

  const directChat = useDirectChat({ merchantId: merchantId || undefined });

  const { chatWindows, openChat, closeChat, sendMessage } = useWebSocketChat({
    maxWindows: 10, actorType: "merchant", actorId: merchantId || undefined,
    onNewMessage: (chatId?: string, message?: { from: string; text: string }) => {
      playSound('message');
      fetchOrderConversationsRef.current?.();
      if (message && message.from !== 'me') {
        toast.showNewMessage('User', message.text?.substring(0, 80));
      }
    },
  });

  const handleOpenChat = useCallback((order: Order) => {
    if (!merchantId) return;
    const dbOrder = order.dbOrder;
    let targetId: string;
    let targetType: 'user' | 'merchant';
    let targetName: string;

    if (order.myRole === 'buyer') {
      if (dbOrder?.merchant_id && dbOrder.merchant_id !== merchantId) {
        targetId = dbOrder.merchant_id; targetType = 'merchant';
        targetName = dbOrder.merchant_username || dbOrder.merchant_display_name || order.user || 'Seller';
      } else {
        targetId = dbOrder?.user_id || order.user || ''; targetType = 'user';
        targetName = order.user || 'User';
      }
    } else {
      if (dbOrder?.buyer_merchant_id && dbOrder.buyer_merchant_id !== merchantId) {
        targetId = dbOrder.buyer_merchant_id; targetType = 'merchant';
        targetName = dbOrder.buyer_merchant_username || dbOrder.buyer_merchant_display_name || order.user || 'Buyer';
      } else {
        targetId = dbOrder?.user_id || order.user || ''; targetType = 'user';
        targetName = order.user || 'User';
      }
    }
    if (!targetId) return;
    directChat.addContact(targetId, targetType);
    directChat.openChat(targetId, targetType, targetName);
  }, [merchantId, directChat]);

  const orderActions = useOrderActions({
    solanaWallet, effectiveBalance, addNotification, playSound,
    afterMutationReconcile, setShowWalletModal, handleOpenChat, setSelectedOrderPopup, openEscrowModalForSell,
  });
  const {
    markingDone, acceptingOrderId, confirmingOrderId, isCreatingTrade, setIsCreatingTrade, createTradeError, setCreateTradeError,
    acceptOrder, acceptWithSaed, retryJoinEscrow, signToClaimOrder, signAndProceed,
    markFiatPaymentSent, markPaymentSent, completeOrder, confirmPayment,
    handleDirectOrderCreation: rawHandleDirectOrderCreation,
  } = orderActions;

  const handleDirectOrderCreation = useCallback((tradeType?: 'buy' | 'sell', priorityFee?: number) => {
    rawHandleDirectOrderCreation(openTradeForm, setOpenTradeForm, tradeType, priorityFee);
  }, [rawHandleDirectOrderCreation, openTradeForm, setOpenTradeForm]);

  const handleCancelOrder = useCallback((order: Order) => {
    if (order.escrowTxHash) openCancelModal(order);
    else cancelOrderWithoutEscrow(order.id);
  }, [openCancelModal, cancelOrderWithoutEscrow]);

  // Direct action handler for in-progress order cards
  const handleOrderAction = useCallback((order: any, action: string) => {
    switch (action) {
      case 'Lock Escrow':
        openEscrowModal(order);
        break;
      case 'Send Fiat Payment':
        markFiatPaymentSent(order);
        break;
      case 'Accept & Mine':
        signToClaimOrder(order);
        break;
      case 'Confirm Receipt':
      case 'Confirm & Release':
      case 'Confirm Payment':
        confirmPayment(order.id);
        break;
      default:
        // For unknown actions, fall back to opening the detail popup
        setSelectedOrderPopup(order);
        break;
    }
  }, [openEscrowModal, markFiatPaymentSent, signToClaimOrder, confirmPayment, setSelectedOrderPopup]);

  // Listen for compliance message notifications → auto-open order details
  useEffect(() => {
    const handler = (e: Event) => {
      const orderId = (e as CustomEvent).detail?.orderId;
      if (orderId) setSelectedOrderId(orderId);
    };
    window.addEventListener('open-order-chat', handler);
    return () => window.removeEventListener('open-order-chat', handler);
  }, []);

  // Fetch dispute info when viewing a chat for a disputed order
  useEffect(() => {
    const activeChat = chatWindows.find(c => c.id === activeChatId || c.orderId === activeChatId);
    if (activeChat?.orderId) {
      const order = orders.find(o => o.id === activeChat.orderId);
      if (order?.status === 'disputed') fetchDisputeInfo(activeChat.orderId);
      else setDisputeInfo(null);
    }
  }, [activeChatId, chatWindows, orders, fetchDisputeInfo]);

  const { handleCreateTrade } = useTradeCreation({
    solanaWallet, effectiveBalance, openTradeForm, setOpenTradeForm,
    setShowOpenTradeModal, setIsCreatingTrade, setCreateTradeError,
    addNotification, playSound, refreshBalance,
  });

  useMerchantRealtimeEvents({
    debouncedFetchOrders, refetchSingleOrder, debouncedFetchConversations, refreshBalance,
    addNotification, playSound, toast, setExtensionRequests,
  });

  // Order filtering
  const hasMyEscrow = (o: Order) => o.isMyOrder || o.myRole === 'seller' || o.orderMerchantId === merchantId;
  const isSelfUnaccepted = (o: Order) => {
    const isSelf = o.isMyOrder || o.orderMerchantId === merchantId;
    if (!isSelf) return false;
    // User sell orders (real user created, merchant assigned via offer) are NOT self-created.
    // Only merchant-created orders (placeholder users) count as "self".
    const dbUsername = o.dbOrder?.user?.username || '';
    const isPlaceholderUser = dbUsername.startsWith('open_order_') || dbUsername.startsWith('m2m_');
    if (!isPlaceholderUser) return false;
    const buyerMid = o.buyerMerchantId || o.dbOrder?.buyer_merchant_id;
    return !o.dbOrder?.accepted_at && !(buyerMid && buyerMid !== merchantId);
  };

  const pendingOrders = useMemo(() => orders.filter(o => {
    if (isOrderExpired(o)) return false;
    const status = getEffectiveStatus(o);
    if (status === "pending") return true;
    if (status === "escrow" && isSelfUnaccepted(o)) return true;
    return false;
  }), [orders]);
  const ongoingOrders = useMemo(() => orders.filter(o => {
    const status = getEffectiveStatus(o);
    if (status !== "escrow") return false;
    if (isSelfUnaccepted(o)) return false;
    if (hasMyEscrow(o)) return true;
    return !isOrderExpired(o);
  }), [orders]);
  const completedOrders = useMemo(() => orders.filter(o => getEffectiveStatus(o) === "completed"), [orders]);
  const cancelledOrders = useMemo(() => orders.filter(o => {
    const status = getEffectiveStatus(o);
    return status === "cancelled" || status === "disputed" ||
      ((status === "active" || status === "pending") && isOrderExpired(o)) ||
      (status === "escrow" && isOrderExpired(o) && !hasMyEscrow(o));
  }), [orders]);

  const todayEarnings = useMemo(() => completedOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0), [completedOrders]);
  const totalTradedVolume = useMemo(() => completedOrders.reduce((sum, o) => sum + o.amount, 0), [completedOrders]);
  const pendingEarnings = useMemo(() => ongoingOrders.reduce((sum, o) => sum + o.amount * TRADER_CUT_CONFIG.best, 0), [ongoingOrders]);
  const totalUnread = directChat.totalUnread;

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

  if (!isLoggedIn) {
    return (
      <LoginScreen
        authTab={authTab} setAuthTab={setAuthTab}
        loginForm={loginForm} setLoginForm={setLoginForm}
        registerForm={registerForm} setRegisterForm={setRegisterForm}
        loginError={loginError} setLoginError={setLoginError}
        isLoggingIn={isLoggingIn} isRegistering={isRegistering}
        isAuthenticating={false}
        onLogin={handleLogin} onRegister={handleRegister}
      />
    );
  }

  // Find the latest order status for the active DM contact (for ReceiptCard)
  const activeContactOrder = directChat.activeContactId
    ? orders.find(o => o.dbOrder?.user_id === directChat.activeContactId || o.buyerMerchantId === directChat.activeContactId)
    : undefined;
  const activeContactOrderStatus = activeContactOrder?.dbOrder?.status || activeContactOrder?.status;

  return (
    <div data-testid="merchant-dashboard" className="h-screen bg-[#060606] text-white flex flex-col overflow-hidden">
      <NotificationToastContainer position="top-right" />
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[600px] h-[400px] bg-white/[0.02] rounded-full blur-[150px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-white/[0.01] rounded-full blur-[200px]" />
      </div>

      <MerchantNavbar
        activePage="dashboard" merchantInfo={merchantInfo}
        embeddedWalletState={embeddedWallet?.state} onLogout={handleLogout}
        onOpenProfile={() => setShowProfileModal(true)}
        rightActions={<>
          <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowTransactionHistory(true)}
            className="p-2 rounded-lg transition-all bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05]" title="Transaction History">
            <History className="w-[18px] h-[18px] text-white/40" />
          </motion.button>
          <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowPaymentMethods(true)}
            className="p-2 rounded-lg transition-all bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05]" title="Payment Methods">
            <Plus className="w-[18px] h-[18px] text-white/40" />
          </motion.button>
          <ConnectionIndicator isConnected={isPusherConnected} />
        </>}
      />

      {/* Mobile Stats Bar */}
      <div className="md:hidden flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.02] border-b border-white/[0.04]">
        <button onClick={() => setShowWalletModal(true)} className="flex items-center gap-1 px-2 py-1 bg-white/[0.04] rounded-md border border-white/[0.08] shrink-0">
          <span className="text-[11px] font-mono text-white/70">{effectiveBalance !== null ? `${effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}</span>
        </button>
        <div className="flex items-center gap-1 px-2 py-1 bg-white/[0.03] rounded-md shrink-0">
          <span className="text-[10px] font-mono text-gray-400">${totalTradedVolume.toLocaleString()}</span>
        </div>
        <div className="flex-1" />
        <button onClick={() => setShowNotifications(!showNotifications)} className="relative p-2.5 bg-white/[0.04] rounded-md shrink-0">
          <Bell className="w-4 h-4 text-gray-400" />
          {notifications.filter(n => !n.read).length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full text-[9px] font-bold flex items-center justify-center text-white">
              {notifications.filter(n => !n.read).length}
            </span>
          )}
        </button>
      </div>

      {/* DESKTOP Layout */}
      <div className="hidden md:flex md:flex-col h-screen overflow-hidden">
        <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden" key={isWideScreen ? 'wide' : 'narrow'}>
        <Panel defaultSize={isWideScreen ? "20%" : "24%"} minSize={isWideScreen ? "14%" : "16%"} maxSize={isWideScreen ? "30%" : "35%"} id="left">
        <div className="flex flex-col h-full bg-[#060606] overflow-y-auto p-2 gap-2">
          <div className="glass-card rounded-xl overflow-hidden flex-shrink-0 border border-white/[0.06]" style={{ height: '48%', minHeight: '260px' }}>
            <DashboardWidgets todayEarnings={todayEarnings} completedOrders={completedOrders.length} cancelledOrders={cancelledOrders.length}
              avgResponseMins={0} rank={12} balance={effectiveBalance || 0} lockedInEscrow={245.50}
              isOnline={isMerchantOnline} merchantId={merchantId || undefined}
              onToggleOnline={() => setIsMerchantOnline(prev => !prev)} onOpenCorridor={() => window.open('/merchant/mempool', '_blank')} />
          </div>
          <div className="glass-card rounded-xl overflow-hidden flex-1 min-h-0 border border-white/[0.06]">
            <ConfigPanel merchantId={merchantId} merchantInfo={merchantInfo} effectiveBalance={effectiveBalance}
              openTradeForm={openTradeForm} setOpenTradeForm={setOpenTradeForm} isCreatingTrade={isCreatingTrade}
              onCreateOrder={handleDirectOrderCreation} refreshBalance={refreshBalance} />
          </div>
        </div>
        </Panel>
        <PanelResizeHandle className="w-[3px]" />
        <Panel defaultSize={isWideScreen ? "24%" : "27%"} minSize="16%" maxSize={isWideScreen ? "35%" : "40%"} id="center-left">
        <div className="flex flex-col h-full bg-black">
          {isWideScreen ? (
            <PendingOrdersPanel orders={pendingOrders} mempoolOrders={mempoolOrders} merchantInfo={merchantInfo}
              onSelectOrder={setSelectedOrderPopup} onSelectMempoolOrder={setSelectedMempoolOrder}
              onAcceptOrder={acceptOrder} acceptingOrderId={acceptingOrderId} onCancelOrder={handleCancelOrder} onOpenChat={handleOpenChat} fetchOrders={fetchOrders} />
          ) : (<>
            <div style={{ height: '60%' }} className="flex flex-col border-b border-white/[0.04]">
              <PendingOrdersPanel orders={pendingOrders} mempoolOrders={mempoolOrders} merchantInfo={merchantInfo}
                onSelectOrder={setSelectedOrderPopup} onSelectMempoolOrder={setSelectedMempoolOrder}
                onAcceptOrder={acceptOrder} acceptingOrderId={acceptingOrderId} onCancelOrder={handleCancelOrder} onOpenChat={handleOpenChat} fetchOrders={fetchOrders} />
            </div>
            <div className="flex-1 flex flex-col min-h-0">
              <LeaderboardPanel leaderboardData={leaderboardData} leaderboardTab={leaderboardTab} setLeaderboardTab={setLeaderboardTab} />
            </div>
          </>)}
        </div>
        </Panel>
        <PanelResizeHandle className="w-[3px]" />
        <Panel defaultSize={isWideScreen ? "20%" : "27%"} minSize={isWideScreen ? "14%" : "18%"} maxSize={isWideScreen ? "32%" : "40%"} id="center-right">
        <div className="flex flex-col h-full bg-black">
          <div className={`flex flex-col border-b border-white/[0.04] transition-all duration-200 ${inProgressCollapsed ? '' : 'flex-1 min-h-0'}`}>
            <InProgressPanel orders={ongoingOrders} onSelectOrder={setSelectedOrderPopup} onAction={handleOrderAction} onOpenChat={handleOpenChat}
              onOpenDispute={(order) => openDisputeModal(order.id)} collapsed={inProgressCollapsed} onCollapseChange={setInProgressCollapsed} />
          </div>
          <div className={`flex flex-col border-b border-white/[0.04] transition-all duration-200 ${completedCollapsed ? '' : 'flex-1 min-h-0'}`}>
            <CompletedOrdersPanel orders={completedOrders} onSelectOrder={setSelectedOrderPopup} collapsed={completedCollapsed} onCollapseChange={setCompletedCollapsed} />
          </div>
          {!isWideScreen && (
            <div className="flex-1 flex flex-col min-h-0">
              <ActivityPanel merchantId={merchantId} completedOrders={completedOrders} cancelledOrders={cancelledOrders}
                ongoingOrders={ongoingOrders} pendingOrders={pendingOrders}
                onRateOrder={(order) => setRatingModalData({ orderId: order.id, counterpartyName: order.user || 'User', counterpartyType: order.isM2M ? 'merchant' : 'user' })}
                onSelectOrder={(orderId) => setSelectedOrderId(orderId)} onCollapseChange={setActivityCollapsed} />
            </div>
          )}
        </div>
        </Panel>
        {isWideScreen && (<>
          <PanelResizeHandle className="w-[3px]" />
          <Panel defaultSize="18%" minSize="12%" maxSize="30%" id="transactions">
          <div className="flex flex-col h-full bg-black">
            <div className={`flex flex-col border-b border-white/[0.04] transition-all duration-200 ${leaderboardCollapsed ? '' : 'flex-1 min-h-0'}`}>
              <LeaderboardPanel leaderboardData={leaderboardData} leaderboardTab={leaderboardTab} setLeaderboardTab={setLeaderboardTab} onCollapseChange={setLeaderboardCollapsed} />
            </div>
            <div className={`flex flex-col transition-all duration-200 ${activityCollapsed ? '' : 'flex-1 min-h-0'}`}>
              <ActivityPanel merchantId={merchantId} completedOrders={completedOrders} cancelledOrders={cancelledOrders}
                ongoingOrders={ongoingOrders} pendingOrders={pendingOrders}
                onRateOrder={(order) => setRatingModalData({ orderId: order.id, counterpartyName: order.user || 'User', counterpartyType: order.isM2M ? 'merchant' : 'user' })}
                onSelectOrder={(orderId) => setSelectedOrderId(orderId)} onCollapseChange={setActivityCollapsed} />
            </div>
          </div>
          </Panel>
        </>)}
        <PanelResizeHandle className="w-[3px]" />
        <Panel defaultSize={isWideScreen ? "18%" : "22%"} minSize={isWideScreen ? "12%" : "15%"} maxSize={isWideScreen ? "30%" : "35%"} id="right">
        <div className="flex flex-col h-full bg-[#060606] overflow-hidden">
          <NotificationsPanel notifications={notifications} onMarkRead={markNotificationRead} onSelectOrder={setSelectedOrderId} />
          <div className="flex-1 flex flex-col min-h-0">
            {directChat.activeContactId ? (
              <DirectChatView contactName={directChat.activeContactName} contactType={directChat.activeContactType}
                messages={directChat.messages} isLoading={directChat.isLoadingMessages}
                onSendMessage={(text, imageUrl) => { directChat.sendMessage(text, imageUrl); playSound('send'); }}
                onBack={() => directChat.closeChat()}
                orderStatus={activeContactOrderStatus} />
            ) : (
              <MerchantChatTabs merchantId={merchantId || ''} conversations={directChat.conversations}
                totalUnread={directChat.totalUnread} isLoading={directChat.isLoadingConversations}
                onOpenChat={(targetId, targetType, username) => { directChat.addContact(targetId, targetType).then(() => { directChat.openChat(targetId, targetType, username); }); }} />
            )}
          </div>
        </div>
        </Panel>
        </PanelGroup>
      </div>

      {/* Mobile View Content */}
      <div className="md:hidden flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-3 pb-20">
          {mobileView === 'orders' && <MobileOrdersView pendingOrders={pendingOrders} bigOrders={bigOrders} onAcceptOrder={acceptOrder} acceptingOrderId={acceptingOrderId} onOpenChat={handleOpenChat} onDismissBigOrder={dismissBigOrder} setMobileView={setMobileView} />}
          {mobileView === 'escrow' && <MobileEscrowView ongoingOrders={ongoingOrders} markingDone={markingDone} onOpenEscrowModal={openEscrowModal} onMarkFiatPaymentSent={markFiatPaymentSent} onConfirmPayment={(order) => confirmPayment(order.id)} onOpenDisputeModal={(orderId) => openDisputeModal(orderId)} onOpenCancelModal={openCancelModal} onOpenChat={handleOpenChat} setMobileView={setMobileView} />}
          {mobileView === 'chat' && <MobileChatView merchantId={merchantId} directChat={directChat} orderStatus={activeContactOrderStatus} playSound={playSound} />}
          {mobileView === 'history' && <MobileHistoryView completedOrders={completedOrders} cancelledOrders={cancelledOrders} merchantId={merchantId} merchantInfo={merchantInfo} historyTab={historyTab} setHistoryTab={setHistoryTab} effectiveBalance={effectiveBalance} totalTradedVolume={totalTradedVolume} todayEarnings={todayEarnings} pendingEarnings={pendingEarnings} onShowAnalytics={() => setShowAnalytics(true)} onShowWalletModal={() => setShowWalletModal(true)} onLogout={handleLogout} />}
          {mobileView === 'marketplace' && merchantId && <MobileMarketplaceView merchantId={merchantId} marketSubTab={marketSubTab} setMarketSubTab={setMarketSubTab} onTakeOffer={(offer) => { setOpenTradeForm({ tradeType: offer.type === 'buy' ? 'sell' : 'buy', cryptoAmount: '', paymentMethod: offer.payment_method as 'bank' | 'cash', spreadPreference: 'fastest', expiryMinutes: 15 }); setShowOpenTradeModal(true); }} onCreateOffer={() => setShowCreateModal(true)} />}
        </main>
      </div>

      {/* Mobile FAB */}
      <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowOpenTradeModal(true)}
        className="md:hidden fixed right-4 bottom-[88px] z-40 w-14 h-14 rounded-full bg-orange-500 shadow-lg shadow-orange-500/25 flex items-center justify-center">
        <Plus className="w-6 h-6 text-black" />
      </motion.button>

      <MobileBottomNav mobileView={mobileView} setMobileView={setMobileView} pendingCount={pendingOrders.length} ongoingCount={ongoingOrders.length} totalUnread={totalUnread} />

      {/* Modals */}
      <DisputeModal showDisputeModal={showDisputeModal} disputeReason={disputeReason} setDisputeReason={setDisputeReason}
        disputeDescription={disputeDescription} setDisputeDescription={setDisputeDescription}
        isSubmittingDispute={isSubmittingDispute} onClose={closeDisputeModal} onSubmit={submitDispute} />

      <EscrowLockModal showEscrowModal={showEscrowModal} escrowOrder={escrowOrder} isLockingEscrow={isLockingEscrow}
        escrowTxHash={escrowTxHash} escrowError={escrowError} effectiveBalance={effectiveBalance}
        onClose={closeEscrowModal} onExecute={executeLockEscrow} />

      {/* EscrowReleaseModal removed — confirmPayment now handles the full flow with a confirmation dialog */}

      <EscrowCancelModal showCancelModal={showCancelModal} cancelOrder={cancelOrder} isCancellingEscrow={isCancellingEscrow}
        cancelTxHash={cancelTxHash} cancelError={cancelError} onClose={closeCancelModal} onExecute={executeCancelEscrow} />

      <WalletPromptModal show={showWalletPrompt && !IS_EMBEDDED_WALLET && !solanaWallet.connected}
        onDismiss={() => setShowWalletPrompt(false)}
        onConnect={() => { setShowWalletPrompt(false); setShowWalletModal(true); }} />

      <AnalyticsModal show={showAnalytics} merchantId={merchantId} onClose={() => setShowAnalytics(false)} />

      <PWAInstallBanner appName="Merchant" accentColor="#f97316" />

      {!IS_EMBEDDED_WALLET && (
        <MerchantWalletModal isOpen={showWalletModal} onClose={() => setShowWalletModal(false)}
          onConnected={() => setShowWalletModal(false)} />
      )}

      {(solanaWallet.walletAddress || (typeof window !== 'undefined' && (window as any).phantom?.solana?.publicKey)) && (
        <UsernameModal isOpen={showUsernameModal}
          walletAddress={solanaWallet.walletAddress || (window as any).phantom?.solana?.publicKey?.toString()}
          onSubmit={handleMerchantUsername} canClose={false} apiEndpoint="/api/auth/merchant" />
      )}

      <MerchantProfileModal isOpen={showProfileModal} onClose={() => setShowProfileModal(false)}
        merchantId={merchantId || ''} currentAvatar={merchantInfo?.avatar_url}
        currentDisplayName={merchantInfo?.display_name} currentBio={merchantInfo?.bio}
        onProfileUpdated={handleProfileUpdated} />

      <TransactionHistoryModal isOpen={showTransactionHistory} onClose={() => setShowTransactionHistory(false)} merchantId={merchantId || ''} />
      <PaymentMethodModal isOpen={showPaymentMethods} onClose={() => setShowPaymentMethods(false)} merchantId={merchantId || ''} />

      {ratingModalData && merchantId && (
        <RatingModal orderId={ratingModalData.orderId} counterpartyName={ratingModalData.counterpartyName}
          counterpartyType={ratingModalData.counterpartyType} raterType="merchant" raterId={merchantId}
          onClose={() => setRatingModalData(null)}
          onSubmit={async (rating, review) => {
            const res = await fetchWithAuth('/api/ratings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ order_id: ratingModalData.orderId, rater_type: 'merchant', rater_id: merchantId, rating, review_text: review }) });
            if (res.ok) { toast.show({ type: 'complete', title: 'Rating Submitted', message: `You rated ${ratingModalData.counterpartyName} ${rating} stars` }); fetchOrders(); }
            else { const data = await res.json(); throw new Error(data.error || 'Failed to submit rating'); }
          }} />
      )}

      {merchantId && <MerchantQuoteModal merchantId={merchantId} corridorId="USDT_AED" isOpen={showMerchantQuoteModal} onClose={() => setShowMerchantQuoteModal(false)} />}

      {selectedMempoolOrder && merchantId && (
        <OrderInspector order={selectedMempoolOrder} merchantId={merchantId} onClose={() => setSelectedMempoolOrder(null)}
          onBump={() => setSelectedMempoolOrder(null)} onAccept={() => setSelectedMempoolOrder(null)} />
      )}

      <CorridorCreateModal isOpen={showCreateModal} corridorForm={corridorForm} setCorridorForm={setCorridorForm}
        effectiveBalance={effectiveBalance} merchantId={merchantId} solanaWalletAddress={solanaWallet.walletAddress}
        onClose={() => setShowCreateModal(false)} onRefreshBalance={() => refreshBalance()} onFetchActiveOffers={fetchActiveOffers} />

      <TradeFormModal isOpen={showOpenTradeModal} openTradeForm={openTradeForm} setOpenTradeForm={setOpenTradeForm}
        effectiveBalance={effectiveBalance} isCreatingTrade={isCreatingTrade} createTradeError={createTradeError}
        setCreateTradeError={setCreateTradeError} onClose={() => setShowOpenTradeModal(false)} onSubmit={handleCreateTrade} />

      <OrderQuickView selectedOrder={selectedOrderPopup} merchantId={merchantId} markingDone={markingDone}
        acceptingOrderId={acceptingOrderId} confirmingOrderId={confirmingOrderId} cancellingOrderId={cancellingOrderId}
        onClose={() => setSelectedOrderPopup(null)} onAcceptOrder={acceptOrder} onOpenEscrowModal={openEscrowModal}
        onMarkFiatPaymentSent={markFiatPaymentSent} onConfirmPayment={confirmPayment}
        onCancelOrderWithoutEscrow={cancelOrderWithoutEscrow} onOpenChat={handleOpenChat}
        onViewFullDetails={(orderId) => setSelectedOrderId(orderId)} />

      {selectedOrderId && merchantId && (
        <OrderDetailsPanel orderId={selectedOrderId} merchantId={merchantId} onClose={() => setSelectedOrderId(null)}
          onOpenChat={(orderId, targetId, targetType, targetName) => {
            // For disputed orders: open ORDER CHAT (chat_messages via useWebSocketChat)
            // so merchant can see compliance messages + reply in the same thread
            const order = orders.find(o => o.id === orderId);
            if (order && (order.status === 'disputed' || order.dbOrder?.status === 'disputed')) {
              openChat(order.user || targetName || 'Dispute Chat', '📋', orderId);
              setActiveChatId(orderId);
              setSelectedOrderId(null);
              return;
            }
            // For non-disputed orders: open DM view as before
            if (targetId && targetType && targetName) {
              directChat.addContact(targetId, targetType);
              directChat.openChat(targetId, targetType, targetName);
            } else {
              if (order) handleOpenChat(order);
            }
            setSelectedOrderId(null);
          }}
          onConfirmPayment={confirmPayment}
          onMarkPaymentSent={(orderId) => { const order = orders.find(o => o.id === orderId); if (order) markFiatPaymentSent(order); }}
          onAcceptOrder={(orderId) => { const order = orders.find(o => o.id === orderId); if (order) acceptOrder(order); }}
          onCancelOrder={(orderId) => { const order = orders.find(o => o.id === orderId); if (order) { if (order.escrowTxHash) openCancelModal(order); else cancelOrderWithoutEscrow(order.id); } }}
          onLockEscrow={(orderId) => { const order = orders.find(o => o.id === orderId); if (order) openEscrowModal(order); }}
          onReleaseEscrow={(orderId) => confirmPayment(orderId)}
          onOpenDispute={openDisputeModal} onRequestCancel={requestCancelOrder} onRespondToCancel={respondToCancelRequest} isRequestingCancel={isRequestingCancel} />
      )}

      {/* Message History Panel (Desktop) */}
      <AnimatePresence>
        {showMessageHistory && merchantId && (
          <motion.div initial={{ opacity: 0, x: 300 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-md z-50 shadow-2xl bg-[#060606] border-l border-white/[0.04]">
            {directChat.activeContactId ? (
              <DirectChatView contactName={directChat.activeContactName} contactType={directChat.activeContactType}
                messages={directChat.messages} isLoading={directChat.isLoadingMessages}
                onSendMessage={(text, imageUrl) => { directChat.sendMessage(text, imageUrl); playSound('send'); }}
                onBack={() => directChat.closeChat()}
                orderStatus={activeContactOrderStatus} />
            ) : (
              <MerchantChatTabs merchantId={merchantId} conversations={directChat.conversations}
                totalUnread={directChat.totalUnread} isLoading={directChat.isLoadingConversations}
                onOpenChat={(targetId, targetType, username) => directChat.openChat(targetId, targetType, username)}
                onClose={() => setShowMessageHistory(false)} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
