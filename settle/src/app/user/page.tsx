"use client";

import "@/components/user/styles/user-theme.css";
import { UserOnboardingFlow } from "@/components/user/UserOnboardingFlow";
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
import { useApp } from "@/context/AppContext";
import { useOrphanedEscrowRecovery } from "@/hooks/useOrphanedEscrowRecovery";
import { ScratchRewardModal } from "@/components/user/ScratchRewardModal";
import { PushPermissionPrompt } from "@/components/PushPermissionPrompt";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { clearAuthStorageOnLogout } from "@/lib/auth/logoutCleanup";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { DesktopSidebar } from "@/components/user/desktop/DesktopSidebar";
import { DesktopRightPanel } from "@/components/user/desktop/DesktopRightPanel";
import { IssueReporter } from "@/components/IssueReporter";

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
const lightPanelBg = { background: "#f4f3f1" } as const;
function Panel({
  k,
  anim = fade,
  className = "",
  style,
  children,
  desktop = false,
}: {
  k: string;
  anim?: typeof fade | typeof slide;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  desktop?: boolean;
}) {
  return (
    <motion.div
      key={k}
      {...anim}
      className={
        desktop
          // Desktop: centered column, 30% wider than mobile (440 × 1.3 ≈ 572px)
          ? `absolute inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-[572px] flex flex-col ${className}`
          // Mobile: centered phone column
          : `absolute inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-[440px] flex flex-col ${className}`
      }
      style={{ background: "var(--user-frame)", ...style }}
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
  SupportScreen,
  SupportTicketScreen,
  RewardsScreen,
  LimitsScreen,
  StakeScreen,
  PointsScreen,
} from "@/components/user/screens";
import { SendScreen } from "@/components/user/screens/SendScreen";
import { ReputationScreen } from "@/components/user/screens/ReputationScreen";

export default function Home() {
  const isDesktop = useIsDesktop();

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

  // Onboarding flow — shown post-login for first-time users only.
  // Keyed per userId so each new account sees it once, returning users never do.
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Navigation history stack. The last entry is the current screen.
  // We keep a real stack (not a single previousScreen) so "back" can unwind
  // history instead of ping-ponging between the last two screens — pressing
  // back from a support detour used to bounce straight back into it because
  // setScreen overwrote previousScreen with the screen you were leaving.
  const [history, setHistory] = useState<Screen[]>(["welcome"]);
  const screen = history[history.length - 1];
  const previousScreen =
    history.length > 1 ? history[history.length - 2] : history[0];
  const setScreen = (s: Screen) => {
    setHistory((h) => {
      const current = h[h.length - 1];
      if (current === s) return h; // already here — no-op
      // If the target is already somewhere in history, treat this as a "back"
      // and unwind to it (pop) rather than pushing a duplicate. This is what
      // makes every existing `setScreen(previousScreen)` back button pop
      // correctly and kills the navigation loop.
      const existingIdx = h.lastIndexOf(s);
      if (existingIdx !== -1) return h.slice(0, existingIdx + 1);
      return [...h, s];
    });
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

  // Preload saved payment methods into AppContext the moment we know the user
  // id (the user app identifies via auth.userId, not AppContext.user). This
  // fills the cache before any sheet opens, so the trade screen's payment
  // selector renders instantly — mirrors the merchant dashboard preload.
  const { fetchPaymentMethods: preloadPaymentMethods } = useApp();
  useEffect(() => {
    if (auth.userId) preloadPaymentMethods(auth.userId);
  }, [auth.userId, preloadPaymentMethods]);

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

  // Show onboarding to first-time users until they actually COMPLETE it. We do
  // NOT mark it "shown" on display — otherwise a refresh mid-flow would treat
  // the flow as finished and skip it. The localStorage key is written only on
  // completion (in onComplete, and below when the server already reports done).
  // Because completion is tracked server-side, showing-until-done can't loop
  // forever: once onComplete fires the flag is set and it never reappears.
  //
  // localStorage is a per-device fast-path cache; the DB
  // (users.onboarding_completed_at, migration 151) is the source of truth. When
  // the local key is missing we don't immediately show the flow — we first ask
  // the server, so a user who already onboarded on another device / cleared
  // their cache isn't shown it again. Only a genuinely-new user (no local key,
  // server says not completed) sees it.
  useEffect(() => {
    if (!auth.userId) return;
    const key = `blip_onb_v1_${auth.userId}`;
    if (localStorage.getItem(key)) return; // fast path — already done on this device

    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth('/api/auth/user/onboarding');
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && data?.data?.completed) {
          // Completed elsewhere — cache locally and don't show.
          try { localStorage.setItem(key, '1'); } catch { /* storage blocked */ }
          return;
        }
      } catch {
        // Network/server error — fall through and show onboarding (the old
        // localStorage-only behavior), so we never hard-block a new user.
      }
      if (cancelled) return;
      // Not completed → show it. No localStorage write here, so a refresh
      // mid-flow re-shows onboarding until it's genuinely finished — the cache
      // key is written only on completion (in onComplete, and above when the
      // server already reports it done).
      setShowOnboarding(true);
    })();

    return () => { cancelled = true; };
  }, [auth.userId]);

  // Restore screen from sessionStorage (e.g. returning from My Tickets back to Support).
  useEffect(() => {
    if (!auth.userId) return;
    try {
      const returnScreen = sessionStorage.getItem("blip_return_screen") as Screen | null;
      if (returnScreen) {
        sessionStorage.removeItem("blip_return_screen");
        setScreen(returnScreen);
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.userId]);

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

  // Once the user is authenticated, strip any leftover login-flow query param
  // (?reason=…) from the URL — it's only meaningful on the login screen, and
  // leaving it in place is confusing when sharing or bookmarking.
  useEffect(() => {
    if (typeof window === "undefined" || !auth.userId) return;
    const url = new URL(window.location.href);
    const junk = ["reason"];
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

  // Logged-out visitors no longer see the sign-in form inline — the user
  // app's login lives at its own route (/user/login). Once auth finishes
  // initializing and we know they're not signed in, hand off to that route.
  useEffect(() => {
    if (auth.isInitializing) return;
    if (screen === "welcome" && typeof window !== "undefined") {
      window.location.replace("/user/login");
    }
  }, [auth.isInitializing, screen]);

  // Session guard while the embedded wallet is locked.
  //
  // The "Unlock Wallet" PIN pad is driven purely by the LOCAL keystore lock
  // state — it makes no protected API call, so the global 401 redirect in
  // fetchWithAuth never fires while it's on screen. If the auth session dies
  // in the background (e.g. the 15-min access token lapses while the user
  // sits on the PIN pad), nothing would otherwise bounce them to login and
  // they'd be stuck entering a PIN against a dead session.
  //
  // So whenever the wallet is locked for a signed-in user, poll the session:
  // on mount, on a 60s interval, and on tab focus. The moment the server says
  // the session is gone, run the shared logout sweep and hand off to
  // /user/login with the session-expired banner.
  useEffect(() => {
    if (auth.isInitializing) return;
    if (!auth.userId) return;
    if (embeddedWallet?.state !== "locked") return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    const verifySession = async () => {
      try {
        const res = await fetchWithAuth(
          `/api/auth/user?action=check_session&user_id=${auth.userId}`,
        );
        if (cancelled) return;
        let valid = res.ok;
        if (res.ok) {
          try {
            const data = await res.json();
            valid = !!(data?.success && data?.data?.valid);
          } catch {
            valid = false;
          }
        }
        if (!valid && !cancelled) {
          clearAuthStorageOnLogout();
          window.location.replace("/user/login?reason=session_expired");
        }
      } catch {
        // Network blip — don't log the user out on a transient failure.
        // The next interval tick (or a real protected call) will catch a
        // genuinely dead session.
      }
    };

    verifySession();
    const interval = window.setInterval(verifySession, 60_000);
    const onFocus = () => verifySession();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [auth.isInitializing, auth.userId, embeddedWallet?.state]);

  // Refer & Earn data — sourced from the same waitlist row as
  // /waitlist/dashboard so the code shown here is the user's *real*
  // referral code (users.referral_code), not a value derived locally.
  //   friends         = count of users this account has referred
  //   blipFromReferrals = sum of credited reward_amount on those referrals
  //                       (excludes register/task bonuses)
  //   totalBlip       = the actor's current blip_points balance
  //                     (register + referrals + tasks combined)
  const [referralInfo, setReferralInfo] = useState<{
    code: string | null;
    friends: number;
    blipFromReferrals: number;
    totalBlip: number;
  }>({ code: null, friends: 0, blipFromReferrals: 0, totalBlip: 0 });
  const [referralLoading, setReferralLoading] = useState(false);
  useEffect(() => {
    if (!auth.userId) {
      setReferralInfo({
        code: null,
        friends: 0,
        blipFromReferrals: 0,
        totalBlip: 0,
      });
      return;
    }
    let cancelled = false;
    setReferralLoading(true);
    (async () => {
      try {
        const res = await fetchWithAuth("/api/waitlist/me");
        if (!res.ok) return;
        const json = (await res.json()) as {
          success?: boolean;
          data?: {
            actor?: {
              referral_code?: string | null;
              blip_points?: number | null;
            };
            referrals?: Array<{
              reward_amount?: number | null;
              reward_status?: string | null;
            }>;
          };
        };
        if (cancelled || !json?.success || !json.data) return;
        const referrals = Array.isArray(json.data.referrals)
          ? json.data.referrals
          : [];
        const blipFromReferrals = referrals.reduce(
          (acc, r) =>
            r?.reward_status === "credited" && typeof r.reward_amount === "number"
              ? acc + r.reward_amount
              : acc,
          0,
        );
        setReferralInfo({
          code: json.data.actor?.referral_code ?? null,
          friends: referrals.length,
          blipFromReferrals,
          totalBlip: json.data.actor?.blip_points ?? 0,
        });
      } catch {
        // Swallow — the screen falls back to "—" and 0s on its own.
      } finally {
        if (!cancelled) setReferralLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.userId]);

  // Consume ?reason=session_expired exactly once on mount, then strip it
  // from the URL so a refresh doesn't re-display the banner. Runs even
  // when the user is unauthenticated (the cleanup above gates on userId,
  // so without this the param sticks on the login screen forever and the
  // banner reappears on every render of <LandingPage />).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("reason") !== "session_expired") return;
    auth.setLoginError("Your session expired. Please sign in again.");
    url.searchParams.delete("reason");
    const clean =
      url.pathname +
      (url.searchParams.toString() ? `?${url.searchParams}` : "") +
      url.hash;
    window.history.replaceState(null, "", clean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const maxW = isDesktop ? "max-w-[572px] mx-auto w-full" : "max-w-[440px] mx-auto";

  // Chat unread count for desktop sidebar badge
  const chatUnreadCount = orders.reduce((sum, o) => sum + (o.unreadCount ?? 0), 0);

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
      // Portal target for full-screen user overlays (e.g. the order chat sheet).
      // Overlays must portal HERE — not document.body — so they keep the
      // `.user-scope` theme variables (bg-surface-base etc.) while still
      // escaping the transformed Panel that breaks `position: fixed`.
      id="user-scope-root"
      className={`user-scope ${isUserLight ? "user-light" : ""}`}
      style={
        isDesktop
          ? { display: "flex", minHeight: "100dvh", background: "#080810", fontFamily: "Manrope, sans-serif" }
          : { minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto", position: "relative", background: "var(--user-bg, #0a0a0a)" }
      }
    >
      {isDesktop && (
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
      )}
      <IssueReporter hideTrigger />
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
      {/* Onboarding — shown once per new user AFTER they sign in/up */}
      {showOnboarding && !!auth.userId && (
        <UserOnboardingFlow
          userId={auth.userId}
          onPasscodeSet={() => {}}
          onComplete={() => {
            try {
              localStorage.setItem(`blip_onb_v1_${auth.userId}`, '1');
            } catch { /* ignore */ }
            // Persist to the DB (source of truth) so completion survives a
            // device switch / cache clear. Fire-and-forget — the localStorage
            // cache already prevents a re-show on this device if this fails.
            fetchWithAuth('/api/auth/user/onboarding', { method: 'POST' })
              .catch(() => { /* best-effort */ });
            setShowOnboarding(false);
          }}
        />
      )}

      {/* Center column — on desktop this is a flex:1 <main>, on mobile a full-width div */}
      <div
        className="relative flex-1 w-full flex flex-col h-dvh"
        style={isDesktop ? { minWidth: 0, overflowX: "hidden" } : undefined}
      >
      <AnimatePresence>
        {screen === "welcome" && (
          // Logged out — the effect above redirects to /user/login. Show a
          // brief spinner during the hand-off instead of the inline form.
          <div className="flex-1 w-full flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-accent-text" />
          </div>
        )}

        {screen === "home" && (
          <Panel
            k="home"
            className="relative"
            style={theme === "light" ? lightPanelBg : darkBg}
            desktop={!!isDesktop}
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
              hideBottomNav={!!isDesktop}
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

        {screen === "send" && (
          <Panel k="send" desktop={!!isDesktop}>
            <SendScreen
              orders={orders}
              setScreen={setScreen}
              solanaWallet={solanaWallet}
            />
          </Panel>
        )}

        {screen === "trade" && (
          <Panel k="trade" desktop={!!isDesktop}>
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
              buyerPaymentTypes={tradeCreation.buyerPaymentTypes}
              onToggleBuyerPaymentType={tradeCreation.toggleBuyerPaymentType}
              setBuyerPaymentTypes={tradeCreation.setBuyerPaymentTypes}
              selectedPair={tradeCreation.selectedPair}
              onPairChange={tradeCreation.setSelectedPair}
              setCurrentRate={tradeCreation.setCurrentRate}
              theme={theme}
              hideBottomNav={!!isDesktop}
            />
          </Panel>
        )}

        {screen === "escrow" && (
          <Panel k="escrow" anim={slide} desktop={!!isDesktop}>
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
              hideBottomNav={!!isDesktop}
              solanaWallet={solanaWallet}
            />
          </Panel>
        )}

        {screen === "order" && activeOrder && (
          <Panel k="order" anim={slide} desktop={!!isDesktop}>
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
          </Panel>
        )}

        {screen === "order" && !activeOrder && activeOrderId && (
          <Panel k="order-loading" className="items-center justify-center" desktop={!!isDesktop}>
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
            desktop={!!isDesktop}
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
              notificationCount={notifications.filter((n) => !n.read).length}
              hideBottomNav={!!isDesktop}
            />
          </Panel>
        )}

        {screen === "support" && (
          <Panel
            k="support"
            anim={slide}
            style={theme === "light" ? lightPanelBg : darkBg}
            desktop={!!isDesktop}
          >
            <SupportScreen
              setScreen={setScreen}
              previousScreen={previousScreen}
            />
          </Panel>
        )}

        {screen === "raise-ticket" && (
          <Panel
            k="raise-ticket"
            anim={slide}
            style={theme === "light" ? lightPanelBg : darkBg}
            desktop={!!isDesktop}
          >
            <SupportTicketScreen
              setScreen={setScreen}
              previousScreen={previousScreen}
              userId={auth.userId ?? undefined}
            />
          </Panel>
        )}

        {screen === "reputation" && (
          <Panel
            k="reputation"
            anim={slide}
            style={theme === "light" ? lightPanelBg : darkBg}
            desktop={!!isDesktop}
          >
            <ReputationScreen
              setScreen={setScreen}
              cancelledOrderCount={cancelledOrders.length}
              totalOrderCount={orders.length}
            />
          </Panel>
        )}

        {screen === "limits" && (
          <Panel
            k="limits"
            anim={slide}
            style={theme === "light" ? lightPanelBg : darkBg}
            desktop={!!isDesktop}
          >
            <LimitsScreen setScreen={setScreen} />
          </Panel>
        )}

        {screen === "stake" && (
          <Panel
            k="stake"
            anim={slide}
            style={theme === "light" ? lightPanelBg : darkBg}
            desktop={!!isDesktop}
          >
            <StakeScreen setScreen={setScreen} />
          </Panel>
        )}

        {screen === "points" && (
          <Panel
            k="points"
            anim={slide}
            style={theme === "light" ? lightPanelBg : darkBg}
            desktop={!!isDesktop}
          >
            <PointsScreen setScreen={setScreen} />
          </Panel>
        )}

        {screen === "rewards" && (
          <Panel
            k="rewards"
            style={theme === "light" ? lightPanelBg : darkBg}
            desktop={!!isDesktop}
          >
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
              hideBottomNav={!!isDesktop}
            />
          </Panel>
        )}

        {screen === "notifications" && (
          <Panel
            k="notifications"
            style={theme === "light" ? lightPanelBg : darkBg}
            desktop={!!isDesktop}
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
              cancelledOrderCount={cancelledOrders.length}
              totalOrderCount={orders.length}
              maxW={maxW}
              hideBottomNav={!!isDesktop}
            />
          </Panel>
        )}

        {screen === "profile" && (
          <Panel
            k="profile"
            className="overflow-hidden relative"
            style={theme === "light" ? lightPanelBg : darkBg}
            desktop={!!isDesktop}
          >
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
              hideBottomNav={!!isDesktop}
            />
          </Panel>
        )}

        {screen === "chats" && (
          <Panel k="chats" desktop={!!isDesktop}>
            <ChatListScreen
              screen={screen}
              setScreen={setScreen}
              orders={orders}
              setActiveOrderId={setActiveOrderId}
              setOrders={setOrders}
              maxW={maxW}
              notificationCount={notifications.filter((n) => !n.read).length}
              hideBottomNav={!!isDesktop}
            />
          </Panel>
        )}

        {screen === "chat-view" && activeOrder && (
          <Panel k="chat-view" anim={slide} className="h-dvh" desktop={!!isDesktop}>
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
              userId={auth.userId ?? undefined}
            />
          </Panel>
        )}

        {screen === "create-offer" && (
          <Panel k="create-offer" anim={slide} desktop={!!isDesktop}>
            <CreateOfferScreen
              setScreen={setScreen}
              tradeType={tradeCreation.tradeType}
              setTradeType={tradeCreation.setTradeType}
            />
          </Panel>
        )}

        {screen === "cash-confirm" && tradeCreation.selectedOffer && (
          <Panel k="cash-confirm" anim={slide} desktop={!!isDesktop}>
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
          <Panel k="wallet" style={theme === "light" ? lightPanelBg : darkBg} desktop={!!isDesktop}>
            <WalletScreen
              screen={screen}
              setScreen={setScreen}
              solanaWallet={solanaWallet}
              embeddedWallet={embeddedWallet}
              setShowWalletModal={auth.setShowWalletModal}
              setShowWalletSetup={auth.setShowWalletSetup}
              setShowWalletUnlock={auth.setShowWalletUnlock}
              maxW={maxW}
              hideBottomNav={!!isDesktop}
            />
          </Panel>
        )}

        {screen === "matching" && pendingTradeData && (
          <Panel k="matching" desktop={!!isDesktop}>
            <MatchingScreen
              setScreen={setScreen}
              pendingTradeData={pendingTradeData}
              matchingTimeLeft={userEffects.matchingTimeLeft}
              formatTimeLeft={userEffects.formatTimeLeft}
              currentRate={tradeCreation.currentRate}
              currency={tradeCreation.selectedPair === "usdt_inr" ? "INR" : "AED"}
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

      {isDesktop && (
        <DesktopRightPanel
          screen={screen}
          setScreen={setScreen}
          activeOrder={activeOrder}
          pendingOrders={pendingOrders}
          setActiveOrderId={setActiveOrderId}
          selectedPair={tradeCreation.selectedPair}
        />
      )}

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
