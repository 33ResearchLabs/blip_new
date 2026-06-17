"use client";

/**
 * /user/desktop — Desktop layout for the user app (testing / WIP).
 * Reuses every hook and screen component from the mobile user route unchanged.
 * New: 3-column shell — DesktopSidebar | main content | DesktopRightPanel.
 */

import "@/components/user/styles/user-theme.css";
import { UserOnboardingFlow } from "@/components/user/UserOnboardingFlow";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useUserTheme } from "@/hooks/useUserTheme";
import { useSounds } from "@/hooks/useSounds";
import {
  NotificationToastContainer,
  useToast,
} from "@/components/NotificationToast";
import { ChatToastHost } from "@/components/user/ChatToastHost";
import { useUserAuth } from "@/hooks/useUserAuth";
import { UserModals } from "@/components/user/UserModals";
import { useUserDataFetching } from "@/hooks/useUserDataFetching";
import { useUserTradeCreation } from "@/hooks/useUserTradeCreation";
import { useUserOrderActions } from "@/hooks/useUserOrderActions";
import { useUserEffects } from "@/hooks/useUserEffects";
import { useSolanaWalletSafe } from "@/hooks/useSolanaWalletSafe";
import { useApp } from "@/context/AppContext";
import { useOrphanedEscrowRecovery } from "@/hooks/useOrphanedEscrowRecovery";
import { ScratchRewardModal } from "@/components/user/ScratchRewardModal";
import { PushPermissionPrompt } from "@/components/PushPermissionPrompt";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

import type { Screen } from "@/components/user/screens/types";
import { FEE_CONFIG } from "@/components/user/screens/helpers";

import {
  HomeScreen,
  TradeCreationScreen,
  EscrowLockScreen,
  OrderDetailScreen,
  OrdersListScreen,
  ProfileScreen,
  ChatListScreen,
  ChatViewScreen,
  CreateOfferScreen,
  CashConfirmScreen,
  MatchingScreen,
  WalletScreen,
  NotificationsScreen,
  SupportScreen,
  RewardsScreen,
  LimitsScreen,
  StakeScreen,
  PointsScreen,
} from "@/components/user/screens";

import { DesktopSidebar } from "@/components/user/desktop/DesktopSidebar";
import { DesktopRightPanel } from "@/components/user/desktop/DesktopRightPanel";

// Slide animation for transient overlays (escrow, order detail, chat)
const slide = {
  initial: { opacity: 0, x: "6%" },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: "-6%" },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
} as const;
const fade = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
  transition: { duration: 0 },
} as const;

// Desktop content panel — fills the center column, no max-width phone cap.
// Each screen gets a scroll container with tasteful max-width for readability.
function CenterPanel({
  k,
  anim = fade,
  children,
}: {
  k: string;
  anim?: typeof fade | typeof slide;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      key={k}
      {...anim}
      className="absolute inset-0 flex flex-col overflow-y-auto"
      style={{ background: "#080810" }}
    >
      {children}
    </motion.div>
  );
}

export default function UserDesktopPage() {
  const { theme, toggleTheme } = useUserTheme();
  const { playSound } = useSounds();
  const rawToast = useToast();
  const solanaWallet = useSolanaWalletSafe();
  const embeddedWallet = (solanaWallet as any)?.embeddedWallet as
    | {
        state: "none" | "locked" | "unlocked";
        actorId: string | null;
        setActorId: (id: string | null) => void;
        unlockWallet: (password: string) => Promise<boolean>;
        migrateToPin?: (oldPassword: string, newPin: string) => Promise<boolean>;
        lockWallet: () => void;
        deleteWallet: () => void;
        setKeypairAndUnlock: (kp: any) => void;
      }
    | undefined;

  const [notifications, setNotifications] = useState<
    Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      timestamp: number;
      read: boolean;
    }>
  >([]);
  const addNotification = useCallback(
    (type: string, title: string, message: string) => {
      setNotifications((prev) =>
        [
          {
            id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type,
            title,
            message,
            timestamp: Date.now(),
            read: false,
          },
          ...prev,
        ].slice(0, 50),
      );
    },
    [],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const toast = useMemo(() => {
    const wrap =
      (
        method: (...args: any[]) => void,
        type: string,
        titleFn: (...args: any[]) => string,
        msgFn: (...args: any[]) => string,
      ) =>
      (...args: any[]) => {
        method(...args);
        addNotification(type, titleFn(...args), msgFn(...args));
      };
    return {
      ...rawToast,
      show: (t: Parameters<typeof rawToast.show>[0]) => {
        rawToast.show(t);
        addNotification(t.type, t.title, t.message);
      },
      showOrderCreated: wrap(rawToast.showOrderCreated, "order", () => "New Order", (i?: string) => i || "A new order has been placed"),
      showPaymentSent: wrap(rawToast.showPaymentSent, "payment", () => "Payment Sent", () => "Payment has been marked as sent"),
      showTradeComplete: wrap(rawToast.showTradeComplete, "complete", () => "Trade Complete", (a?: string) => (a ? `${a} USDT completed` : "Trade completed")),
      showEscrowLocked: wrap(rawToast.showEscrowLocked, "escrow", () => "Escrow Locked", (a?: string) => (a ? `${a} USDT locked` : "Funds locked in escrow")),
      showDisputeOpened: wrap(rawToast.showDisputeOpened, "dispute", () => "Dispute Opened", () => "A dispute has been raised"),
      showNewMessage: wrap(rawToast.showNewMessage, "message", (f: string) => `Message from ${f}`, (_f: string, p?: string) => p || "New message"),
      showWarning: wrap(rawToast.showWarning, "warning", () => "Warning", (m: string) => m),
      showOrderCancelled: wrap(rawToast.showOrderCancelled, "warning", () => "Order Cancelled", () => "Order has been cancelled"),
      showOrderExpired: wrap(rawToast.showOrderExpired, "warning", () => "Order Expired", () => "Order has expired"),
      showEscrowReleased: wrap(rawToast.showEscrowReleased, "complete", () => "Escrow Released", () => "Funds have been released"),
      showMerchantAccepted: wrap(rawToast.showMerchantAccepted, "order", () => "Merchant Accepted", (n?: string) => (n ? `${n} accepted your order` : "Order accepted")),
      showExtensionRequest: wrap(rawToast.showExtensionRequest, "system", () => "Extension Request", (_w: string, m?: number) => m ? `${m} minutes requested` : "Time extension requested"),
    };
  }, [rawToast, addNotification]);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [screen, setScreenRaw] = useState<Screen>("welcome");
  const [previousScreen, setPreviousScreen] = useState<Screen>("welcome");
  const setScreen = (s: Screen) => {
    setPreviousScreen(screen);
    setScreenRaw(s);
  };
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activityTab, setActivityTab] = useState<"active" | "completed" | "cancelled">("active");
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState(0);
  const [timedOutOrders, setTimedOutOrders] = useState<any[]>([]);
  const [pendingTradeData, setPendingTradeData] = useState<{
    amount: string;
    fiatAmount: string;
    type: "buy" | "sell";
    paymentMethod: "bank" | "cash";
  } | null>(null);
  const extensionRequestSetterRef = useRef<(req: any) => void>(() => {});

  const {
    orders,
    setOrders,
    setBankAccounts,
    resolvedDisputes,
    setResolvedDisputes,
    fetchOrders,
    fetchBankAccounts,
    fetchResolvedDisputes,
  } = useUserDataFetching();

  const auth = useUserAuth({
    setScreen,
    setOrders,
    setBankAccounts,
    setResolvedDisputes,
    solanaWallet,
    escrowTxStatus: "idle",
    setEscrowTxStatus: () => {},
    fetchOrders,
    fetchBankAccounts,
    fetchResolvedDisputes,
  });

  usePresenceHeartbeat(!!auth.userId);

  useEffect(() => {
    if (!embeddedWallet) return;
    embeddedWallet.setActorId(auth.userId ?? null);
  }, [embeddedWallet, auth.userId]);

  const { fetchPaymentMethods: preloadPaymentMethods } = useApp();
  useEffect(() => {
    if (auth.userId) preloadPaymentMethods(auth.userId);
  }, [auth.userId, preloadPaymentMethods]);

  useOrphanedEscrowRecovery({
    userId: auth.userId,
    onRecovered: () => {
      if (auth.userId) fetchOrders(auth.userId);
    },
  });

  const tradeCreation = useUserTradeCreation({
    userId: auth.userId,
    setScreen,
    setOrders,
    setActiveOrderId,
    setPendingTradeData,
    solanaWallet,
    playSound,
    toast,
    setUserId: auth.setUserId,
    setShowWalletModal: auth.setShowWalletModal,
  });

  const userEffects = useUserEffects({
    userId: auth.userId,
    screen,
    setScreen,
    activeOrderId,
    orders,
    setOrders,
    pendingTradeData,
    setPendingTradeData,
    escrowTxStatus: tradeCreation.escrowTxStatus,
    setEscrowTxStatus: tradeCreation.setEscrowTxStatus,
    setAmount: tradeCreation.setAmount,
    setSelectedOffer: tradeCreation.setSelectedOffer,
    solanaWallet,
    playSound,
    toast,
    setExtensionRequest: (req: any) => {
      extensionRequestSetterRef.current(req);
    },
  });

  const { activeOrder } = userEffects;

  const orderActions = useUserOrderActions({
    userId: auth.userId,
    activeOrder,
    solanaWallet,
    playSound,
    toast,
    showBrowserNotification: userEffects.showBrowserNotification,
    setOrders,
    setIsLoading: auth.setIsLoading,
    fetchOrders,
  });
  extensionRequestSetterRef.current = orderActions.setExtensionRequest;

  useEffect(() => {
    if (!auth.userId) return;
    const key = `blip_onb_v1_${auth.userId}`;
    if (localStorage.getItem(key)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth("/api/auth/user/onboarding");
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && data?.data?.completed) {
          try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
          return;
        }
      } catch { /* fall through */ }
      if (cancelled) return;
      setShowOnboarding(true);
    })();
    return () => { cancelled = true; };
  }, [auth.userId]);

  const prevScreenRef = useRef(screen);
  useEffect(() => {
    if (screen === "home" && prevScreenRef.current !== "home") {
      if (auth.userId) fetchOrders(auth.userId);
      setActiveOrderId(null);
    }
    prevScreenRef.current = screen;
  }, [screen, auth.userId, fetchOrders]);

  useEffect(() => {
    if (typeof window === "undefined" || !auth.userId) return;
    const url = new URL(window.location.href);
    const junk = ["reason"];
    let mutated = false;
    for (const key of junk) {
      if (url.searchParams.has(key)) { url.searchParams.delete(key); mutated = true; }
    }
    if (mutated) {
      const clean = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash;
      window.history.replaceState(null, "", clean);
    }
  }, [auth.userId]);

  useEffect(() => {
    if (auth.isInitializing) return;
    if (screen === "welcome" && typeof window !== "undefined") {
      window.location.replace("/user/login");
    }
  }, [auth.isInitializing, screen]);

  const [referralInfo, setReferralInfo] = useState<{
    code: string | null;
    friends: number;
    blipFromReferrals: number;
    totalBlip: number;
  }>({ code: null, friends: 0, blipFromReferrals: 0, totalBlip: 0 });
  const [referralLoading, setReferralLoading] = useState(false);
  useEffect(() => {
    if (!auth.userId) { setReferralInfo({ code: null, friends: 0, blipFromReferrals: 0, totalBlip: 0 }); return; }
    let cancelled = false;
    setReferralLoading(true);
    (async () => {
      try {
        const res = await fetchWithAuth("/api/waitlist/me");
        if (!res.ok) return;
        const json = (await res.json()) as { success?: boolean; data?: { actor?: { referral_code?: string | null; blip_points?: number | null }; referrals?: Array<{ reward_amount?: number | null; reward_status?: string | null }> } };
        if (cancelled || !json?.success || !json.data) return;
        const referrals = Array.isArray(json.data.referrals) ? json.data.referrals : [];
        const blipFromReferrals = referrals.reduce((acc, r) => r?.reward_status === "credited" && typeof r.reward_amount === "number" ? acc + r.reward_amount : acc, 0);
        setReferralInfo({ code: json.data.actor?.referral_code ?? null, friends: referrals.length, blipFromReferrals, totalBlip: json.data.actor?.blip_points ?? 0 });
      } catch { /* swallow */ } finally {
        if (!cancelled) setReferralLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [auth.userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("reason") !== "session_expired") return;
    auth.setLoginError("Your session expired. Please sign in again.");
    url.searchParams.delete("reason");
    const clean = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash;
    window.history.replaceState(null, "", clean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingOrders = orders.filter((o) => !["complete", "cancelled", "expired", "disputed"].includes(o.status));
  const completedOrders = orders.filter((o) => o.status === "complete");

  const prevOrderStatusRef = useRef<Map<string, string>>(new Map());
  const [showScratchReward, setShowScratchReward] = useState(false);
  useEffect(() => {
    const prev = prevOrderStatusRef.current;
    let justCompletedSell = false;
    for (const o of orders) {
      const cur = String(o.status);
      const was = prev.get(o.id);
      prev.set(o.id, cur);
      if (was && was !== cur && (cur === "complete" || cur === "completed") && o.type === "sell") {
        justCompletedSell = true;
      }
    }
    if (justCompletedSell) setShowScratchReward(true);
  }, [orders]);

  const cancelledOrders = orders.filter((o) => o.status === "cancelled" || o.status === "expired");

  useEffect(() => {
    if (screen === "escrow" && activeOrder && ["complete", "cancelled", "expired", "disputed"].includes(activeOrder.status)) {
      setScreen("order");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, activeOrder?.status]);

  const fiatAmount = tradeCreation.amount ? (parseFloat(tradeCreation.amount) * tradeCreation.currentRate).toFixed(2) : "0";
  const currentFees = FEE_CONFIG[tradeCreation.tradePreference];

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // On desktop the phone-width cap is lifted. Screens still render at a
  // comfortable reading width (max-w-2xl) via the center column's padding.
  const maxW = "max-w-3xl mx-auto w-full";

  const isUserLight = theme === "light";

  // ── Slide/fade logic: same rules as mobile ─────────────────────────────────
  // Tab screens → fade (instant), transient overlays → slide
  const isSlideScreen = ["escrow", "order", "chat-view", "create-offer", "cash-confirm", "support"].includes(screen);

  // ── Chat unread count for sidebar badge ────────────────────────────────────
  const chatUnreadCount = orders.reduce((sum, o) => sum + (o.unreadCount ?? 0), 0);

  if (auth.isInitializing) {
    return (
      <div className={`user-scope ${isUserLight ? "user-light" : ""} h-dvh flex items-center justify-center`} style={{ background: "#080810" }}>
        <Loader2 className="w-8 h-8 animate-spin text-accent-text" />
      </div>
    );
  }

  return (
    <div
      id="user-scope-root"
      className={`user-scope ${isUserLight ? "user-light" : ""}`}
      style={{ display: "flex", minHeight: "100dvh", background: "#080810", fontFamily: "Manrope, sans-serif" }}
    >
      <NotificationToastContainer position="top-right" />

      {auth.userId && (
        <ChatToastHost
          onOpenChat={(orderId) => {
            setActiveOrderId(orderId);
            setScreen("chat-view");
          }}
        />
      )}

      {/* Onboarding overlay */}
      {showOnboarding && !!auth.userId && (
        <UserOnboardingFlow
          userId={auth.userId}
          onPasscodeSet={() => {}}
          onComplete={() => {
            try { localStorage.setItem(`blip_onb_v1_${auth.userId}`, "1"); } catch { /* ignore */ }
            fetchWithAuth("/api/auth/user/onboarding", { method: "POST" }).catch(() => {});
            setShowOnboarding(false);
          }}
        />
      )}

      {/* ── LEFT SIDEBAR ──────────────────────────────────────────────────── */}
      <DesktopSidebar
        screen={screen}
        setScreen={setScreen}
        userName={auth.userName}
        userAvatar={auth.userAvatar ?? null}
        userId={auth.userId}
        userBalance={auth.userBalance}
        notificationCount={notifications.filter((n) => !n.read).length}
        chatUnreadCount={chatUnreadCount}
      />

      {/* ── CENTER CONTENT ────────────────────────────────────────────────── */}
      <main style={{ flex: 1, position: "relative", minWidth: 0, overflowX: "hidden" }}>
        {screen === "welcome" && (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-accent-text" />
          </div>
        )}

        <AnimatePresence>
          {screen === "home" && (
            <CenterPanel k="home">
              <HomeScreen
                userName={auth.userName}
                userId={auth.userId}
                orders={orders}
                completedOrders={completedOrders}
                pendingOrders={pendingOrders}
                currentRate={tradeCreation.currentRate}
                selectedPair={tradeCreation.selectedPair}
                screen={screen}
                setScreen={setScreen}
                setTradeType={tradeCreation.setTradeType}
                setActiveOrderId={setActiveOrderId}
                setPendingTradeData={setPendingTradeData}
                setShowWalletModal={auth.setShowWalletModal}
                setShowWalletSetup={auth.setShowWalletSetup}
                setShowWalletUnlock={auth.setShowWalletUnlock}
                solanaWallet={solanaWallet}
                embeddedWallet={embeddedWallet}
                userBalance={auth.userBalance}
                maxW={maxW}
                notificationCount={notifications.filter((n) => !n.read).length}
                hideBottomNav
                onRefresh={async () => {
                  if (!auth.userId) return;
                  await Promise.all([fetchOrders(auth.userId), fetchBankAccounts(auth.userId), fetchResolvedDisputes(auth.userId)]);
                }}
                onUpiPayConfirm={(data) => {
                  tradeCreation.setTradeType("sell");
                  tradeCreation.setAmount(String(data.cryptoUsdt));
                  try {
                    sessionStorage.setItem("blip_pending_upi_payment", JSON.stringify({ vpa: data.vpa, payeeName: data.payeeName, fiatInr: data.fiatInr, cryptoUsdt: data.cryptoUsdt, qrAmount: data.qrAmount, note: data.note, at: Date.now() }));
                  } catch { /* ignore */ }
                  setScreen("escrow");
                }}
              />
            </CenterPanel>
          )}

          {screen === "trade" && (
            <CenterPanel k="trade">
              <TradeCreationScreen
                screen={screen}
                setScreen={setScreen}
                tradeType={tradeCreation.tradeType}
                setTradeType={tradeCreation.setTradeType}
                tradePreference={tradeCreation.tradePreference}
                setTradePreference={tradeCreation.setTradePreference}
                paymentMethod={tradeCreation.paymentMethod}
                setPaymentMethod={tradeCreation.setPaymentMethod}
                amount={tradeCreation.amount}
                setAmount={tradeCreation.setAmount}
                fiatAmount={fiatAmount}
                currentFees={currentFees}
                isLoading={tradeCreation.isLoading}
                userId={auth.userId}
                startTrade={tradeCreation.startTrade}
                solanaWallet={solanaWallet}
                selectedPaymentMethodId={tradeCreation.selectedPaymentMethod?.id || null}
                onSelectPaymentMethod={tradeCreation.setSelectedPaymentMethod}
                buyerPaymentTypes={tradeCreation.buyerPaymentTypes}
                onToggleBuyerPaymentType={tradeCreation.toggleBuyerPaymentType}
                setBuyerPaymentTypes={tradeCreation.setBuyerPaymentTypes}
                selectedPair={tradeCreation.selectedPair}
                onPairChange={tradeCreation.setSelectedPair}
                setCurrentRate={tradeCreation.setCurrentRate}
                theme={theme}
                hideBottomNav
              />
            </CenterPanel>
          )}

          {screen === "escrow" && (
            <CenterPanel k="escrow" anim={slide}>
              <EscrowLockScreen
                screen={screen}
                setScreen={setScreen}
                amount={tradeCreation.amount}
                fiatAmount={fiatAmount}
                currentRate={tradeCreation.currentRate}
                escrowTxStatus={tradeCreation.escrowTxStatus}
                setEscrowTxStatus={tradeCreation.setEscrowTxStatus}
                escrowTxHash={tradeCreation.escrowTxHash}
                escrowError={tradeCreation.escrowError}
                setEscrowError={tradeCreation.setEscrowError}
                isLoading={tradeCreation.isLoading}
                confirmEscrow={tradeCreation.confirmEscrow}
                selectedBankDetails={tradeCreation.selectedBankDetails}
                setSelectedBankDetails={tradeCreation.setSelectedBankDetails}
                selectedPaymentMethod={tradeCreation.selectedPaymentMethod}
                userId={auth.userId}
                setShowWalletModal={auth.setShowWalletModal}
                onConnectWallet={() => {
                  if (embeddedWallet) {
                    if (embeddedWallet.state === "none") auth.setShowWalletSetup(true);
                    else if (embeddedWallet.state === "locked") auth.setShowWalletUnlock(true);
                  } else {
                    auth.setShowWalletModal(true);
                  }
                }}
                fiatCurrency={tradeCreation.selectedPair === "usdt_inr" ? "INR" : "AED"}
                hideBottomNav
                solanaWallet={solanaWallet}
              />
            </CenterPanel>
          )}

          {screen === "order" && activeOrder && (
            <CenterPanel k="order" anim={slide}>
              <OrderDetailScreen
                setScreen={setScreen}
                previousScreen={previousScreen}
                activeOrder={activeOrder}
                isLoading={auth.isLoading}
                setIsLoading={auth.setIsLoading}
                handleOpenChat={userEffects.handleOpenChat}
                markPaymentSent={orderActions.markPaymentSent}
                confirmFiatReceived={orderActions.confirmFiatReceived}
                refetchActiveOrder={userEffects.refetchActiveOrder}
                rating={rating}
                setRating={setRating}
                submitReview={orderActions.submitRating}
                copied={copied}
                handleCopy={handleCopy}
                extensionRequest={orderActions.extensionRequest}
                requestExtension={orderActions.requestExtension}
                respondToExtension={orderActions.respondToExtension}
                requestingExtension={orderActions.requestingExtension}
                showChat={userEffects.showChat}
                setShowChat={userEffects.setShowChat}
                chatMessage={userEffects.chatMessage}
                setChatMessage={userEffects.setChatMessage}
                chatInputRef={userEffects.chatInputRef}
                chatMessagesRef={userEffects.chatMessagesRef}
                activeChat={userEffects.activeChat as any}
                handleSendMessage={userEffects.handleSendMessage}
                sendChatMessage={userEffects.sendChatMessage}
                sendTypingIndicator={userEffects.sendTypingIndicator}
                showAppeal={orderActions.showAppeal}
                setShowAppeal={orderActions.setShowAppeal}
                appealReason={orderActions.appealReason}
                setAppealReason={orderActions.setAppealReason}
                appealDescription={orderActions.appealDescription}
                setAppealDescription={orderActions.setAppealDescription}
                submitAppeal={orderActions.submitAppeal}
                isSubmittingAppeal={orderActions.isSubmittingAppeal}
                showDisputeModal={orderActions.showDisputeModal}
                setShowDisputeModal={orderActions.setShowDisputeModal}
                disputeReason={orderActions.disputeReason}
                setDisputeReason={orderActions.setDisputeReason}
                disputeDescription={orderActions.disputeDescription}
                setDisputeDescription={orderActions.setDisputeDescription}
                submitDispute={orderActions.submitDispute}
                isSubmittingDispute={orderActions.isSubmittingDispute}
                disputeInfo={orderActions.disputeInfo}
                respondToResolution={orderActions.respondToResolution}
                isRespondingToResolution={orderActions.isRespondingToResolution}
                requestCancelOrder={orderActions.requestCancelOrder}
                cancelOrderDirect={orderActions.cancelOrderDirect}
                respondToCancelRequest={orderActions.respondToCancelRequest}
                isRequestingCancel={orderActions.isRequestingCancel}
                claimRefund={orderActions.claimRefund}
                isClaimingRefund={orderActions.isClaimingRefund}
                solanaWallet={solanaWallet}
                setShowWalletModal={auth.setShowWalletModal}
                userId={auth.userId}
                setOrders={setOrders}
                playSound={playSound}
                maxW={maxW}
              />
            </CenterPanel>
          )}

          {screen === "order" && !activeOrder && activeOrderId && (
            <CenterPanel k="order-loading">
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
              </div>
            </CenterPanel>
          )}

          {screen === "orders" && (
            <CenterPanel k="orders">
              <OrdersListScreen
                screen={screen}
                setScreen={setScreen}
                setActiveOrderId={setActiveOrderId}
                activityTab={activityTab}
                setActivityTab={setActivityTab}
                pendingOrders={pendingOrders}
                completedOrders={completedOrders}
                cancelledOrders={cancelledOrders}
                maxW={maxW}
                notificationCount={notifications.filter((n) => !n.read).length}
                hideBottomNav
              />
            </CenterPanel>
          )}

          {screen === "support" && (
            <CenterPanel k="support" anim={slide}>
              <SupportScreen setScreen={setScreen} previousScreen={previousScreen} />
            </CenterPanel>
          )}

          {screen === "rewards" && (
            <CenterPanel k="rewards">
              <RewardsScreen
                screen={screen}
                setScreen={setScreen}
                maxW={maxW}
                notificationCount={notifications.filter((n) => !n.read).length}
                referralCode={referralInfo.code ?? "—"}
                friendsJoined={referralInfo.friends}
                blipEarned={referralInfo.blipFromReferrals}
                totalBlip={referralInfo.totalBlip}
                isLoading={referralLoading}
                hideBottomNav
              />
            </CenterPanel>
          )}

          {screen === "limits" && (
            <CenterPanel k="limits">
              <LimitsScreen setScreen={setScreen} />
            </CenterPanel>
          )}

          {screen === "stake" && (
            <CenterPanel k="stake">
              <StakeScreen setScreen={setScreen} />
            </CenterPanel>
          )}

          {screen === "points" && (
            <CenterPanel k="points">
              <PointsScreen setScreen={setScreen} />
            </CenterPanel>
          )}

          {screen === "notifications" && (
            <CenterPanel k="notifications">
              <NotificationsScreen
                screen={screen}
                setScreen={setScreen}
                notifications={notifications}
                onMarkRead={(id) => setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))}
                onMarkAllRead={() => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))}
                unreadCount={notifications.filter((n) => !n.read).length}
                maxW={maxW}
                hideBottomNav
              />
            </CenterPanel>
          )}

          {screen === "profile" && (
            <CenterPanel k="profile">
              <ProfileScreen
                screen={screen}
                setScreen={setScreen}
                userId={auth.userId}
                userName={auth.userName}
                userAvatar={auth.userAvatar}
                setUserAvatar={auth.setUserAvatar}
                completedOrders={completedOrders}
                timedOutOrders={timedOutOrders}
                solanaWallet={solanaWallet}
                setShowWalletModal={auth.setShowWalletModal}
                embeddedWallet={embeddedWallet}
                setShowWalletSetup={auth.setShowWalletSetup}
                setShowWalletUnlock={auth.setShowWalletUnlock}
                resolvedDisputes={resolvedDisputes}
                theme={theme}
                toggleTheme={toggleTheme}
                isAuthenticatingRef={auth.isAuthenticatingRef}
                lastAuthenticatedWalletRef={auth.lastAuthenticatedWalletRef}
                authAttemptedForWalletRef={auth.authAttemptedForWalletRef}
                setShowUsernameModal={auth.setShowUsernameModal}
                setUserId={auth.setUserId}
                setUserWallet={auth.setUserWallet}
                setUserName={auth.setUserName}
                setUserBalance={auth.setUserBalance}
                setOrders={setOrders}
                setResolvedDisputes={setResolvedDisputes}
                setLoginError={auth.setLoginError}
                setLoginForm={auth.setLoginForm}
                maxW={maxW}
                hideBottomNav
              />
            </CenterPanel>
          )}

          {screen === "chats" && (
            <CenterPanel k="chats">
              <ChatListScreen
                screen={screen}
                setScreen={setScreen}
                orders={orders}
                setActiveOrderId={setActiveOrderId}
                setOrders={setOrders}
                maxW={maxW}
                notificationCount={notifications.filter((n) => !n.read).length}
                hideBottomNav
              />
            </CenterPanel>
          )}

          {screen === "chat-view" && activeOrder && (
            <CenterPanel k="chat-view" anim={slide}>
              <ChatViewScreen
                setScreen={setScreen}
                activeOrder={activeOrder}
                activeChat={userEffects.activeChat}
                chatMessage={userEffects.chatMessage}
                setChatMessage={userEffects.setChatMessage}
                sendChatMessage={userEffects.sendChatMessage}
                chatMessagesRef={userEffects.chatMessagesRef}
                onLoadOlder={activeOrder ? () => userEffects.loadOlderMessages(activeOrder.id) : undefined}
                hasOlderMessages={activeOrder ? userEffects.hasOlderMessages(activeOrder.id) : false}
                isLoadingOlder={activeOrder ? userEffects.isLoadingOlderMessages(activeOrder.id) : false}
                onTyping={userEffects.sendTypingIndicator}
                isCounterpartyTyping={!!(userEffects.activeChat as any)?.isTyping}
                userId={auth.userId ?? undefined}
              />
            </CenterPanel>
          )}

          {screen === "create-offer" && (
            <CenterPanel k="create-offer" anim={slide}>
              <CreateOfferScreen
                setScreen={setScreen}
                tradeType={tradeCreation.tradeType}
                setTradeType={tradeCreation.setTradeType}
              />
            </CenterPanel>
          )}

          {screen === "cash-confirm" && tradeCreation.selectedOffer && (
            <CenterPanel k="cash-confirm" anim={slide}>
              <CashConfirmScreen
                setScreen={setScreen}
                selectedOffer={tradeCreation.selectedOffer}
                setSelectedOffer={tradeCreation.setSelectedOffer}
                tradeType={tradeCreation.tradeType}
                amount={tradeCreation.amount}
                fiatAmount={fiatAmount}
                isLoading={tradeCreation.isLoading}
                confirmCashOrder={tradeCreation.confirmCashOrder}
              />
            </CenterPanel>
          )}

          {screen === "wallet" && (
            <CenterPanel k="wallet">
              <WalletScreen
                screen={screen}
                setScreen={setScreen}
                solanaWallet={solanaWallet}
                embeddedWallet={embeddedWallet}
                setShowWalletModal={auth.setShowWalletModal}
                setShowWalletSetup={auth.setShowWalletSetup}
                setShowWalletUnlock={auth.setShowWalletUnlock}
                maxW={maxW}
                hideBottomNav
              />
            </CenterPanel>
          )}

          {screen === "matching" && pendingTradeData && (
            <CenterPanel k="matching">
              <MatchingScreen
                setScreen={setScreen}
                pendingTradeData={pendingTradeData}
                matchingTimeLeft={userEffects.matchingTimeLeft}
                formatTimeLeft={userEffects.formatTimeLeft}
                currentRate={tradeCreation.currentRate}
                currency={tradeCreation.selectedPair === "usdt_inr" ? "INR" : "AED"}
                activeOrderId={activeOrderId}
                orderStatus={orders.find((o) => o.id === activeOrderId)?.dbStatus ?? "pending"}
                userId={auth.userId}
                setOrders={setOrders}
                setActiveOrderId={setActiveOrderId}
                setPendingTradeData={setPendingTradeData}
                toast={toast}
                maxW={maxW}
              />
            </CenterPanel>
          )}
        </AnimatePresence>
      </main>

      {/* ── RIGHT PANEL ───────────────────────────────────────────────────── */}
      <DesktopRightPanel
        screen={screen}
        setScreen={setScreen}
        activeOrder={activeOrder}
        pendingOrders={pendingOrders}
        setActiveOrderId={setActiveOrderId}
        selectedPair={tradeCreation.selectedPair}
        referralCode={referralInfo.code}
      />

      <UserModals
        showWalletModal={auth.showWalletModal}
        setShowWalletModal={auth.setShowWalletModal}
        handleSolanaWalletConnect={auth.handleSolanaWalletConnect}
        showWalletUnlock={auth.showWalletUnlock}
        setShowWalletUnlock={auth.setShowWalletUnlock}
        showWalletSetup={auth.showWalletSetup}
        setShowWalletSetup={auth.setShowWalletSetup}
        embeddedWallet={embeddedWallet}
        solanaWallet={solanaWallet}
        showUsernameModal={auth.showUsernameModal}
        handleWalletUsername={auth.handleWalletUsername}
        showAcceptancePopup={userEffects.showAcceptancePopup}
        setShowAcceptancePopup={userEffects.setShowAcceptancePopup}
        acceptedOrderInfo={userEffects.acceptedOrderInfo}
      />

      <PushPermissionPrompt authed={!!auth.userId} />

      <ScratchRewardModal
        open={showScratchReward}
        onClose={() => setShowScratchReward(false)}
        onDone={() => { setShowScratchReward(false); setScreen("home"); }}
      />
    </div>
  );
}
