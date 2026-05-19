"use client";

import "@/components/user/styles/user-theme.css";
import { LandingPage } from "@/components/user/LandingPage";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
// TransactionProgress removed — simple loading on buttons instead
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Loader2 } from "lucide-react";
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
import { useOrphanedEscrowRecovery } from "@/hooks/useOrphanedEscrowRecovery";
import { IssueReporter } from "@/components/IssueReporter";
import { ScratchRewardModal } from "@/components/user/ScratchRewardModal";
import { PushPermissionPrompt } from "@/components/PushPermissionPrompt";

import type { Screen } from "@/components/user/screens/types";
import { FEE_CONFIG } from "@/components/user/screens/helpers";

// `fade` is the default Panel animation and is a deliberate no-op
// (opacity stays at 1, transition duration 0) — used for the 5 BottomNav
// tab screens (home / trade / chats / orders / profile) plus the welcome
// screen. Previously these used an opacity crossfade (0→1 entering, 1→0
// exiting) with AnimatePresence in concurrent mode, which left both panels
// at intermediate opacity at the midpoint — the blend showed through as
// visible flashing/flickering when switching tabs. With opacity locked at
// 1, the entering panel (rendered after the exiting one in DOM order)
// fully covers the exiting one the moment it mounts, so the tab change is
// instant and reads cleanly — matching iOS/Material tab-bar conventions.
//
// `slide` keeps its push-navigation feel for transient overlays (escrow /
// order / chat-view / create-offer etc.) where motion is expected.
const fade = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
  transition: { duration: 0 },
} as const;
const slide = {
  initial: { opacity: 0, x: '8%' },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: '-8%' },
  transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const },
} as const;
const darkBg = { background: "#080810" } as const;
const lightPanelBg = { background: "#ffffff" } as const;
function Panel({
  k,
  anim = fade,
  className = "",
  style,
  children,
}: {
  k: string;
  anim?: typeof fade | typeof slide;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      key={k}
      {...anim}
      // `transition` is spread in from `anim` (fade → duration 0, slide →
      // 0.26s) — see the comments above the `fade`/`slide` constants for
      // the rationale behind the per-anim transition timing.
      //
      // Absolute-positioned + horizontally centered so the entering and
      // exiting screens overlap during the transition. Solid background
      // (falls back to var(--user-frame) when no `style` is provided) makes
      // sure nothing behind the panel ever shows through.
      className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-[440px] flex flex-col ${className}`}
      style={{ background: 'var(--user-frame)', ...style }}
    >
      {children}
    </motion.div>
  );
}
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
} from "@/components/user/screens";

export default function Home() {
  // User route uses its own dark/light state — independent of the merchant
  // ThemeContext (which has 7 themes). Stored under localStorage key
  // 'user_theme' so it never collides with the merchant 'theme' key.
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

  // Persistent notification history (captured from toasts)
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
      ); // Keep max 50
    },
    [],
  );

  // Wrapped toast that also persists notification history
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
      showOrderCreated: wrap(
        rawToast.showOrderCreated,
        "order",
        () => "New Order",
        (i?: string) => i || "A new order has been placed",
      ),
      showPaymentSent: wrap(
        rawToast.showPaymentSent,
        "payment",
        () => "Payment Sent",
        () => "Payment has been marked as sent",
      ),
      showTradeComplete: wrap(
        rawToast.showTradeComplete,
        "complete",
        () => "Trade Complete",
        (a?: string) => (a ? `${a} USDT completed` : "Trade completed"),
      ),
      showEscrowLocked: wrap(
        rawToast.showEscrowLocked,
        "escrow",
        () => "Escrow Locked",
        (a?: string) => (a ? `${a} USDT locked` : "Funds locked in escrow"),
      ),
      showDisputeOpened: wrap(
        rawToast.showDisputeOpened,
        "dispute",
        () => "Dispute Opened",
        () => "A dispute has been raised",
      ),
      showNewMessage: wrap(
        rawToast.showNewMessage,
        "message",
        (f: string) => `Message from ${f}`,
        (_f: string, p?: string) => p || "New message",
      ),
      showWarning: wrap(
        rawToast.showWarning,
        "warning",
        () => "Warning",
        (m: string) => m,
      ),
      showOrderCancelled: wrap(
        rawToast.showOrderCancelled,
        "warning",
        () => "Order Cancelled",
        () => "Order has been cancelled",
      ),
      showOrderExpired: wrap(
        rawToast.showOrderExpired,
        "warning",
        () => "Order Expired",
        () => "Order has expired",
      ),
      showEscrowReleased: wrap(
        rawToast.showEscrowReleased,
        "complete",
        () => "Escrow Released",
        () => "Funds have been released",
      ),
      showMerchantAccepted: wrap(
        rawToast.showMerchantAccepted,
        "order",
        () => "Merchant Accepted",
        (n?: string) => (n ? `${n} accepted your order` : "Order accepted"),
      ),
      showExtensionRequest: wrap(
        rawToast.showExtensionRequest,
        "system",
        () => "Extension Request",
        (_w: string, m?: number) =>
          m ? `${m} minutes requested` : "Time extension requested",
      ),
    };
  }, [rawToast, addNotification]);

  const [screen, setScreenRaw] = useState<Screen>("welcome");
  const [previousScreen, setPreviousScreen] = useState<Screen>("welcome");
  const setScreen = (s: Screen) => {
    setPreviousScreen(screen);
    setScreenRaw(s);
  };
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activityTab, setActivityTab] = useState<
    "active" | "completed" | "cancelled"
  >("active");
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

  // Data fetching. bankAccounts / addBankAccount / fetchBankAccounts /
  // setBankAccounts are still destructured because useUserAuth wires them
  // into the legacy /api/users/[id]/bank-accounts endpoint that
  // BankAccountSelector (EscrowLockScreen fallback) still calls. They are
  // intentionally not threaded into ProfileScreen anymore — the new
  // PaymentMethodSelector owns that surface.
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

  // Auth
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

  // Send presence heartbeat so other parties (merchants) see this user as online
  usePresenceHeartbeat(!!auth.userId);

  // Hand the wallet context the current user id so its storage probe targets
  // the right per-user slot. Without this, a fresh signup on a device that
  // once held another user's wallet would inherit the old "Unlock Wallet"
  // prompt for a blob they can't decrypt.
  useEffect(() => {
    if (!embeddedWallet) return;
    embeddedWallet.setActorId(auth.userId ?? null);
  }, [embeddedWallet, auth.userId]);

  // Heal any on-chain sell escrows whose POST /api/orders failed in a
  // previous session. The hook reads `blip_orphan_sell_<txHash>` localStorage
  // entries written by useUserTradeCreation, retries the original POST with
  // the same idempotency key, and clears the entry on success.
  useOrphanedEscrowRecovery({
    userId: auth.userId,
    onRecovered: () => {
      if (auth.userId) fetchOrders(auth.userId);
    },
  });

  // Trade creation
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

  // Effects (realtime, timers, chat)
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

  // Order actions
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

  // Refetch orders when returning to home screen so completed/cancelled orders update.
  // Also drop activeOrderId: otherwise a stale id from a prior order survives into
  // the next trade-creation flow and the order screen flashes the previous order's
  // data before the new id/state commits.
  const prevScreenRef = useRef(screen);
  useEffect(() => {
    if (screen === "home" && prevScreenRef.current !== "home") {
      if (auth.userId) fetchOrders(auth.userId);
      setActiveOrderId(null);
    }
    prevScreenRef.current = screen;
  }, [screen, auth.userId, fetchOrders]);

  // Once the user is authenticated, strip login-flow query params (?welcome=skip,
  // ?tab=signin, ?reason=…) from the URL. They're only meaningful on the landing
  // screen — leaving them in place keeps the URL looking like "/?welcome=skip"
  // for the entire session, which is confusing when sharing or bookmarking.
  useEffect(() => {
    if (typeof window === "undefined" || !auth.userId) return;
    const url = new URL(window.location.href);
    const junk = ["welcome", "tab", "reason"];
    let mutated = false;
    for (const key of junk) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        mutated = true;
      }
    }
    if (mutated) {
      const clean =
        url.pathname +
        (url.searchParams.toString() ? `?${url.searchParams}` : "") +
        url.hash;
      window.history.replaceState(null, "", clean);
    }
  }, [auth.userId]);

  const pendingOrders = orders.filter(
    (o) => !["complete", "cancelled", "expired", "disputed"].includes(o.status),
  );
  const completedOrders = orders.filter((o) => o.status === "complete");
  // ── Scratch-card reward modal trigger ───────────────────────────────────
  // When a SELL order transitions to "complete"/"completed" we surface a
  // scratch card with the freshly-granted reward (granted server-side in
  // core-api on status=completed). Track previous statuses in a ref so we
  // only fire on the *transition*, not on every render.
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

  const cancelledOrders = orders.filter(
    (o) => o.status === "cancelled" || o.status === "expired",
  );

  // Defensive guard: if the user is on the escrow screen but the active order
  // has already moved to a terminal state (completed / cancelled / expired /
  // disputed), bounce them to OrderDetail. This protects any path where
  // 'screen=escrow' is left mounted after the order finished.
  useEffect(() => {
    if (
      screen === "escrow" &&
      activeOrder &&
      ["complete", "cancelled", "expired", "disputed"].includes(
        activeOrder.status,
      )
    ) {
      setScreen("order");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, activeOrder?.status]);

  const fiatAmount = tradeCreation.amount
    ? (parseFloat(tradeCreation.amount) * tradeCreation.currentRate).toFixed(2)
    : "0";
  const currentFees = FEE_CONFIG[tradeCreation.tradePreference];

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const maxW = "max-w-[440px] mx-auto";

  // The user route only uses two themes: dark (default) and light.
  const isUserLight = theme === "light";

  if (auth.isInitializing) {
    return (
      <div
        className={`user-scope ${isUserLight ? "user-light" : ""} h-dvh flex items-center justify-center overflow-hidden`}
        style={{ background: "var(--user-frame)" }}
      >
        <Loader2 className="w-8 h-8 animate-spin text-accent-text" />
      </div>
    );
  }

  return (
    <div
      className={`user-scope ${isUserLight ? "user-light" : ""} min-h-dvh flex flex-col items-center overflow-y-auto relative`}
      style={{ background: "var(--user-frame)" }}
    >
      <NotificationToastContainer position="top-right" />
      {/* Global chat-toast overlay — shows per-order popups for inbound
          merchant messages on any screen. Tap jumps into that order's
          chat. Suppressed automatically when the chat is already open
          (publisher gates the event in useUserEffects). */}
      {auth.userId && (
        <ChatToastHost
          onOpenChat={(orderId) => {
            setActiveOrderId(orderId);
            setScreen("chat-view");
          }}
        />
      )}
      {/* TransactionProgress removed — simple loading on buttons instead */}
      {/* Crossfade host: relative + flex-1 so absolute-positioned <Panel>s
          stack on top of each other during transitions. Dropping mode="wait"
          lets the outgoing screen fade out while the incoming fades in,
          avoiding the parent-frame flash. */}
      <div className="relative flex-1 w-full flex flex-col">
      <AnimatePresence>
        {screen === "welcome" &&
          (() => {
            // Parse query params for login route redirects
            const params =
              typeof window !== "undefined"
                ? new URLSearchParams(window.location.search)
                : null;
            const skipWelcome = params?.get("welcome") === "skip";
            const reason = params?.get("reason");
            // Show "session expired" banner by pre-filling loginError once on mount
            if (
              skipWelcome &&
              reason === "session_expired" &&
              !auth.loginError
            ) {
              setTimeout(
                () =>
                  auth.setLoginError(
                    "Your session expired. Please sign in again.",
                  ),
                0,
              );
            }
            return (
              <LandingPage
                loginForm={auth.loginForm}
                setLoginForm={auth.setLoginForm}
                authMode={auth.authMode}
                setAuthMode={auth.setAuthMode}
                handleUserLogin={auth.handleUserLogin}
                handleUserRegister={auth.handleUserRegister}
                isLoggingIn={auth.isLoggingIn}
                loginError={auth.loginError}
                setLoginError={auth.setLoginError}
                pendingVerificationEmail={auth.pendingVerificationEmail}
                onClearPendingVerification={auth.clearPendingVerification}
                onResendVerification={auth.handleResendVerification}
                isResendingVerification={auth.isResendingVerification}
                verificationSuccessNotice={auth.verificationSuccessNotice}
                onDismissVerificationSuccess={auth.dismissVerificationSuccess}
                skipWelcome={skipWelcome}
              />
            );
          })()}

        {screen === "home" && (
          <Panel
            k="home"
            className="relative"
            style={theme === "light" ? lightPanelBg : darkBg}
          >
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
              onRefresh={async () => {
                if (!auth.userId) return;
                // Refresh the surfaces visible on home: orders list + bank
                // accounts + resolved-dispute markers. Run in parallel so the
                // spinner only stays up as long as the slowest request.
                await Promise.all([
                  fetchOrders(auth.userId),
                  fetchBankAccounts(auth.userId),
                  fetchResolvedDisputes(auth.userId),
                ]);
              }}
              onUpiPayConfirm={(data) => {
                // Prefill the trade state with the scanned UPI payment as a
                // SELL order, then route to the escrow screen where the
                // existing on-chain lock code runs.
                tradeCreation.setTradeType('sell');
                tradeCreation.setAmount(String(data.cryptoUsdt));
                // Stash merchant info so downstream screens / order POST can
                // include the UPI VPA + payee in the payment_method payload.
                try {
                  sessionStorage.setItem(
                    'blip_pending_upi_payment',
                    JSON.stringify({
                      vpa: data.vpa,
                      payeeName: data.payeeName,
                      fiatInr: data.fiatInr,
                      // Audit F-3: record the QR's own asserted amount so
                      // downstream order POST can pass it to upi_qr_amount.
                      // null = open-ended QR (user typed the amount).
                      qrAmount: data.qrAmount,
                      note: data.note,
                      at: Date.now(),
                    }),
                  );
                } catch { /* sessionStorage may be blocked — non-fatal */ }
                setScreen('escrow');
              }}
            />
          </Panel>
        )}

        {screen === "trade" && (
          <Panel k="trade">
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
              selectedPaymentMethodId={
                tradeCreation.selectedPaymentMethod?.id || null
              }
              onSelectPaymentMethod={tradeCreation.setSelectedPaymentMethod}
              selectedPair={tradeCreation.selectedPair}
              onPairChange={tradeCreation.setSelectedPair}
              setCurrentRate={tradeCreation.setCurrentRate}
              theme={theme}
            />
          </Panel>
        )}

        {screen === "escrow" && (
          <Panel k="escrow" anim={slide}>
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
                  if (embeddedWallet.state === "none")
                    auth.setShowWalletSetup(true);
                  else if (embeddedWallet.state === "locked")
                    auth.setShowWalletUnlock(true);
                } else {
                  auth.setShowWalletModal(true);
                }
              }}
              fiatCurrency={
                tradeCreation.selectedPair === "usdt_inr" ? "INR" : "AED"
              }
              solanaWallet={solanaWallet}
            />
          </Panel>
        )}

        {screen === "order" && activeOrder && (
          <Panel k="order" anim={slide}>
            <OrderDetailScreen
              setScreen={setScreen}
              previousScreen={previousScreen}
              activeOrder={activeOrder}
              isLoading={auth.isLoading}
              setIsLoading={auth.setIsLoading}
              handleOpenChat={userEffects.handleOpenChat}
              markPaymentSent={orderActions.markPaymentSent}
              confirmFiatReceived={orderActions.confirmFiatReceived}
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
          </Panel>
        )}

        {screen === "order" && !activeOrder && activeOrderId && (
          <Panel k="order-loading" className="items-center justify-center">
            <div className="h-12" />
            <div className="px-5 py-4 flex items-center w-full">
              <button onClick={() => setScreen("home")} className="p-2 -ml-2">
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
              <h1 className="flex-1 text-center text-[17px] font-semibold text-white pr-8">
                Order Details
              </h1>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto mb-3" />
                <p className="text-[15px] text-neutral-400">Loading order...</p>
              </div>
            </div>
          </Panel>
        )}

        {screen === "orders" && (
          <Panel
            k="orders"
            className="relative"
            style={theme === "light" ? lightPanelBg : darkBg}
          >
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
            />
          </Panel>
        )}

        {screen === "notifications" && (
          <Panel
            k="notifications"
            style={theme === "light" ? lightPanelBg : darkBg}
          >
            <NotificationsScreen
              screen={screen}
              setScreen={setScreen}
              notifications={notifications}
              onMarkRead={(id) =>
                setNotifications((prev) =>
                  prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
                )
              }
              onMarkAllRead={() =>
                setNotifications((prev) =>
                  prev.map((n) => ({ ...n, read: true })),
                )
              }
              unreadCount={notifications.filter((n) => !n.read).length}
              maxW={maxW}
            />
          </Panel>
        )}

        {screen === "profile" && (
          <Panel
            k="profile"
            className="overflow-hidden relative"
            style={theme === "light" ? lightPanelBg : darkBg}
          >
            <ProfileScreen
              screen={screen}
              setScreen={setScreen}
              userId={auth.userId}
              userName={auth.userName}
              completedOrders={completedOrders}
              timedOutOrders={timedOutOrders}
              solanaWallet={solanaWallet}
              setShowWalletModal={auth.setShowWalletModal}
              embeddedWallet={embeddedWallet}
              setShowWalletSetup={auth.setShowWalletSetup}
              setShowWalletUnlock={auth.setShowWalletUnlock}
              copied={copied}
              setCopied={setCopied}
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
            />
          </Panel>
        )}

        {screen === "chats" && (
          <Panel k="chats">
            <ChatListScreen
              screen={screen}
              setScreen={setScreen}
              orders={orders}
              setActiveOrderId={setActiveOrderId}
              setOrders={setOrders}
              maxW={maxW}
              notificationCount={notifications.filter((n) => !n.read).length}
            />
          </Panel>
        )}

        {screen === "chat-view" && activeOrder && (
          <Panel k="chat-view" anim={slide} className="h-dvh">
            <ChatViewScreen
              setScreen={setScreen}
              activeOrder={activeOrder}
              activeChat={userEffects.activeChat}
              chatMessage={userEffects.chatMessage}
              setChatMessage={userEffects.setChatMessage}
              sendChatMessage={userEffects.sendChatMessage}
              chatMessagesRef={userEffects.chatMessagesRef}
              onLoadOlder={
                activeOrder
                  ? () => userEffects.loadOlderMessages(activeOrder.id)
                  : undefined
              }
              hasOlderMessages={
                activeOrder
                  ? userEffects.hasOlderMessages(activeOrder.id)
                  : false
              }
              isLoadingOlder={
                activeOrder
                  ? userEffects.isLoadingOlderMessages(activeOrder.id)
                  : false
              }
              onTyping={userEffects.sendTypingIndicator}
              isCounterpartyTyping={!!(userEffects.activeChat as any)?.isTyping}
            />
          </Panel>
        )}

        {screen === "create-offer" && (
          <Panel k="create-offer" anim={slide}>
            <CreateOfferScreen
              setScreen={setScreen}
              tradeType={tradeCreation.tradeType}
              setTradeType={tradeCreation.setTradeType}
            />
          </Panel>
        )}

        {screen === "cash-confirm" && tradeCreation.selectedOffer && (
          <Panel k="cash-confirm" anim={slide}>
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
          </Panel>
        )}

        {screen === "wallet" && (
          <Panel k="wallet">
            <WalletScreen
              screen={screen}
              setScreen={setScreen}
              solanaWallet={solanaWallet}
              embeddedWallet={embeddedWallet}
              setShowWalletModal={auth.setShowWalletModal}
              setShowWalletSetup={auth.setShowWalletSetup}
              setShowWalletUnlock={auth.setShowWalletUnlock}
              maxW={maxW}
            />
          </Panel>
        )}

        {screen === "matching" && pendingTradeData && (
          <Panel k="matching">
            <MatchingScreen
              setScreen={setScreen}
              pendingTradeData={pendingTradeData}
              matchingTimeLeft={userEffects.matchingTimeLeft}
              formatTimeLeft={userEffects.formatTimeLeft}
              currentRate={tradeCreation.currentRate}
              activeOrderId={activeOrderId}
              userId={auth.userId}
              setOrders={setOrders}
              setPendingTradeData={setPendingTradeData}
              toast={toast}
              maxW={maxW}
            />
          </Panel>
        )}
      </AnimatePresence>
      </div>

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

      {/* Issue reporter floating button removed per UX feedback — the
          inline bug icon in the header still routes to the same reporter
          via openIssueReporter() if needed. */}

      <PushPermissionPrompt authed={!!auth.userId} />

      {/* Scratch-card reward — opens automatically when a sell order
          transitions to completed. After "Back to wallet", route to home. */}
      <ScratchRewardModal
        open={showScratchReward}
        onClose={() => setShowScratchReward(false)}
        onDone={() => {
          setShowScratchReward(false);
          setScreen("home");
        }}
      />
    </div>
  );
}
