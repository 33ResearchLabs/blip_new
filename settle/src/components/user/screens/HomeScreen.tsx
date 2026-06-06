"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  ArrowUpRight,
  ArrowDownLeft,
  QrCode,
  Download,
  ChevronRight,
  Copy,
  Check,
  X,
  Loader2,
  Gift,
  MoreHorizontal,
  Clock,
} from "lucide-react";
import * as QRCode from "qrcode";
import { UpiPayScreen } from "@/components/user/UpiPayScreen";
import { BottomNav } from "./BottomNav";
import { useState as useStateHook, useEffect, useRef } from "react";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { ArrowDown } from "lucide-react";
import type { Screen, Order } from "./types";
import { UserAvatar } from "@/components/ui/UserAvatar";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';
const IS_MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

export interface HomeScreenProps {
  userName: string;
  userId: string | null;
  orders: Order[];
  completedOrders: Order[];
  pendingOrders: Order[];
  currentRate: number;
  /** Currently selected fiat corridor — drives the rate-label currency */
  selectedPair?: 'usdt_aed' | 'usdt_inr';
  screen: Screen;
  setScreen: (s: Screen) => void;
  setTradeType: (t: "buy" | "sell") => void;
  /**
   * Called when user completes a UPI QR scan + amount entry. Parent should
   * prefill trade state (type=sell, amount in USDT, payment method = UPI
   * with the scanned VPA) and route to the escrow-lock screen.
   */
  onUpiPayConfirm?: (data: {
    vpa: string;
    payeeName: string;
    fiatInr: number;
    cryptoUsdt: number;
    note: string;
    /** INR amount asserted by the scanned QR (audit F-3). Null when the
     *  QR did not specify an amount. */
    qrAmount: number | null;
  }) => void;
  setActiveOrderId: (id: string) => void;
  setPendingTradeData: (data: { amount: string; fiatAmount: string; type: "buy" | "sell"; paymentMethod: "bank" | "cash" } | null) => void;
  setShowWalletModal: (v: boolean) => void;
  setShowWalletSetup: (v: boolean) => void;
  setShowWalletUnlock: (v: boolean) => void;
  solanaWallet: {
    connected: boolean;
    walletAddress: string | null;
    usdtBalance: number | null;
    solBalance?: number | null;
    usdcBalance?: number | null;
  };
  embeddedWallet?: {
    state: 'none' | 'locked' | 'unlocked';
  };
  userBalance?: number;
  maxW: string;
  notificationCount?: number;
  hideBottomNav?: boolean;
  /**
   * Pull-to-refresh handler. Wired to the transactions list scroll container.
   * Should refetch orders + balances. May return a promise — the spinner
   * spins until it resolves.
   */
  onRefresh?: () => void | Promise<void>;
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Single transaction row ────────────────────────────────────────────────
function TxRow({ order, onPress }: { order: Order; index: number; onPress: () => void; avatarUrl?: string }) {
  const isBuy = order.type === 'buy';
  const amount = parseFloat(order.fiatAmount);
  const isActive = order.status !== 'complete';

  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onPress}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        textAlign: 'left', padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer',
      }}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <UserAvatar
          src={order.merchant.avatarUrl}
          seed={order.merchant.name}
          size={36}
          style={{ borderRadius: 12 }}
        />
        {isActive && (
          <motion.div
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.4, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 8, height: 8, borderRadius: 999,
              background: '#10b981', border: '2px solid #f4f3f1',
            }}
          />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#14151a', letterSpacing: '-0.005em', marginBottom: 1 }}>
          {isBuy ? 'Buy USDT' : 'Sell USDT'}
        </p>
        <p style={{ fontSize: 10, fontWeight: 500, color: '#80828c' }}>
          {order.merchant.name} · {formatDate(order.createdAt)}
        </p>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p style={{
          fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: 'ui-monospace, monospace',
          color: isBuy ? '#DC2626' : '#059669',
        }}>
          {isBuy ? '-' : '+'}{order.fiatCode === 'INR' ? '₹' : order.fiatCode === 'USD' ? '$' : 'د.إ'}{amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </p>
        <p style={{ fontSize: 10, fontWeight: 500, color: '#80828c', marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>
          {parseFloat(order.cryptoAmount).toFixed(2)} USDT
        </p>
      </div>
    </motion.button>
  );
}

// ─── BlipMark SVG ─────────────────────────────────────────────────────────
function BlipMark() {
  return (
    <svg viewBox="0 0 30 24" width={22} height={Math.round(22 * 24 / 30)} fill="none"
      stroke="#ffb02e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 13h4.5l3-8.5 4.5 17 3-10 2.2 4.5H28" />
    </svg>
  );
}

// ─── HomeScreen ─────────────────────────────────────────────────────────────
export const HomeScreen = ({
  userName,
  userId,
  orders,
  completedOrders,
  pendingOrders,
  currentRate,
  selectedPair,
  screen,
  setScreen,
  setTradeType,
  setActiveOrderId,
  setPendingTradeData,
  setShowWalletModal,
  setShowWalletSetup,
  setShowWalletUnlock,
  solanaWallet,
  embeddedWallet,
  userBalance,
  maxW,
  notificationCount = 0,
  hideBottomNav = false,
  onUpiPayConfirm,
  onRefresh,
}: HomeScreenProps) => {
  const homeRootRef = useRef<HTMLDivElement | null>(null);
  const txScrollRef = useRef<HTMLDivElement | null>(null);
  const PTR_THRESHOLD = 68;
  // Time-based greeting — mirrors MobileHomeView (merchant side).
  const greetingHour = new Date().getHours();
  const greeting =
    greetingHour < 12
      ? "Good morning"
      : greetingHour < 17
        ? "Good afternoon"
        : "Good evening";
  const {
    pull: ptrPull,
    status: ptrStatus,
    progress: ptrProgress,
    isRefreshing: ptrRefreshing,
  } = usePullToRefresh({
    onRefresh: async () => { if (onRefresh) await onRefresh(); },
    threshold: PTR_THRESHOLD,
    enabled: !!onRefresh,
    targetRef: homeRootRef,
    scrollContainerRef: txScrollRef,
    isAtTop: () => (txScrollRef.current?.scrollTop ?? 0) <= 0,
  });
  const ptrActive = ptrPull > 0 || ptrRefreshing;
  const ptrIsDragging = ptrStatus === "pulling" || ptrStatus === "ready";
  const ptrTransition = ptrIsDragging
    ? "none"
    : "transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 360ms cubic-bezier(0.34, 1.56, 0.64, 1), top 360ms cubic-bezier(0.34, 1.56, 0.64, 1)";
  const ptrIndicatorScale = 0.55 + Math.min(ptrProgress, 1) * 0.55;
  const ptrIndicatorRotation = ptrRefreshing ? 0 : ptrProgress * 220;
  const ptrLabel = ptrStatus === "refreshing" ? "Refreshing…" : ptrStatus === "ready" ? "Release to refresh" : "Pull to refresh";
  const PTR_PILL_REST = 50;
  const ptrPillTranslate = (ptrRefreshing ? PTR_THRESHOLD : ptrPull) - PTR_PILL_REST;
  const ptrLabelTop = Math.max((ptrRefreshing ? PTR_THRESHOLD : ptrPull) - 6, -16);

  const displayBalance = IS_MOCK_MODE ? (userBalance ?? 0) : solanaWallet.usdtBalance;
  const isWalletReady = IS_MOCK_MODE ? (userBalance !== undefined && userBalance !== null) : solanaWallet.connected;
  // A wallet can EXIST but be locked (needs PIN) — e.g. after logout or
  // re-opening the browser once the decrypted session is cleared. That is
  // NOT the same as having no wallet, so we prompt to Unlock instead of
  // showing the "Set up wallet" new-user state. Embedded-mode only; mock /
  // external-wallet modes never report a 'locked' state so this stays false.
  const isWalletLocked = IS_EMBEDDED_WALLET && embeddedWallet?.state === 'locked';
  const fiatLabel = selectedPair === 'usdt_aed' ? 'AED' : 'INR';
  const fiatSymbol = selectedPair === 'usdt_aed' ? 'د.إ' : '₹';

  const balanceNum = displayBalance ?? 0;
  const balWhole = Math.floor(balanceNum).toLocaleString('en-US');
  const balDec = (balanceNum % 1).toFixed(2).slice(1);
  const balFiat = (balanceNum * currentRate).toLocaleString('en-US', { maximumFractionDigits: 2 });

  const TERMINAL_STATUSES = ['completed', 'cancelled', 'expired'];
  const unreadCount = orders.reduce(
    (s, o) => s + (TERMINAL_STATUSES.includes(String(o.dbStatus)) ? 0 : (o.unreadCount || 0)),
    0,
  );

  const [showDeposit, setShowDeposit] = useStateHook(false);
  const [showUpiPay, setShowUpiPay] = useStateHook(false);
  const [qrDataUrl, setQrDataUrl] = useStateHook<string | null>(null);
  const [depositCopied, setDepositCopied] = useStateHook(false);
  // "Coming soon" toast for not-yet-shipped actions (e.g. Request). The toast
  // auto-dismisses via the effect below, so the click handler stays ref-free.
  const [comingSoon, setComingSoon] = useStateHook(false);
  const showComingSoon = () => setComingSoon(true);
  useEffect(() => {
    if (!comingSoon) return;
    const t = setTimeout(() => setComingSoon(false), 1900);
    return () => clearTimeout(t);
  }, [comingSoon]);

  useEffect(() => {
    if (!showDeposit || !solanaWallet.walletAddress) return;
    QRCode.toDataURL(solanaWallet.walletAddress, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
      color: { dark: "#0B0F14", light: "#FFFFFF" },
    }).then(setQrDataUrl).catch(() => setQrDataUrl(null));
  }, [showDeposit, solanaWallet.walletAddress]);

  // Scan icon SVG
  const ScanIcon = ({ size = 17, color = "#0b0b0d" }: { size?: number; color?: string }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M3.5 12h17" />
    </svg>
  );

  return (
    <div
      ref={homeRootRef}
      style={{
        position: 'relative', height: '100dvh', background: '#161619',
        display: 'flex', flexDirection: 'column', fontFamily: 'Manrope, sans-serif', overflow: 'hidden',
      }}
    >
      {/* PTR indicator */}
      {onRefresh && (
        <>
          <div
            aria-hidden
            style={{
              pointerEvents: 'none', position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              borderRadius: 999, filter: 'blur(32px)', zIndex: 59,
              top: ptrPillTranslate - 60, width: 220, height: 220,
              background: 'radial-gradient(circle, rgba(255,255,255,0.60) 0%, rgba(167,180,255,0.30) 38%, rgba(167,180,255,0) 72%)',
              opacity: Math.min(ptrProgress, 1) * 0.95,
              transition: ptrTransition,
            }}
          />
          <div
            aria-hidden={!ptrActive}
            style={{
              pointerEvents: 'none', position: 'absolute', left: '50%', zIndex: 60,
              display: 'flex', width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
              borderRadius: 999, background: 'white', top: 0,
              transform: `translate3d(-50%, ${ptrPillTranslate}px, 0) scale(${ptrIndicatorScale}) rotate(${ptrIndicatorRotation}deg)`,
              opacity: Math.min(0.25 + ptrProgress * 0.9, 1),
              transition: ptrTransition,
              boxShadow: `0 8px 24px -6px rgba(0,0,0,0.45)`,
              border: '1px solid rgba(255,255,255,0.85)',
            }}
          >
            {ptrRefreshing ? (
              <Loader2 style={{ width: 18, height: 18, color: '#27272a', animation: 'spin 1s linear infinite' }} />
            ) : (
              <ArrowDown
                style={{
                  width: 18, height: 18, color: '#27272a',
                  transform: `rotate(${ptrStatus === 'ready' ? 180 : 0}deg)`,
                  transition: 'transform 220ms',
                }}
              />
            )}
          </div>
          {ptrActive && (
            <div
              style={{
                pointerEvents: 'none', position: 'absolute', left: 0, right: 0, zIndex: 60,
                display: 'flex', justifyContent: 'center',
                top: ptrLabelTop, opacity: Math.min(ptrProgress * 1.4, 1), transition: ptrTransition,
              }}
            >
              <span style={{
                borderRadius: 999, padding: '3px 12px', fontSize: 10.5, fontWeight: 600,
                color: '#fff', background: 'rgba(15,23,42,0.78)', backdropFilter: 'blur(8px)',
              }}>
                {ptrLabel}
              </span>
            </div>
          )}
        </>
      )}

      {/* INK HEADER — fixed, does not scroll */}
      <div style={{
        flexShrink: 0,
        background: '#161619', color: '#fff',
        padding: '16px 22px 44px',
        borderBottomLeftRadius: 36, borderBottomRightRadius: 36,
      }}>
          {/* Top row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Left: BlipMark + greeting */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'rgba(255,255,255,0.14)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <BlipMark />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.72 }}>{greeting}</span>
                <span style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: '-0.01em' }}>
                  {(() => {
                    if (!userName) return userName;
                    // Google login stores email as username with @ and . replaced by _
                    // e.g. zoopweb333@gmail.com → zoopweb333_gmail_com
                    // Strip common email domain suffixes
                    let n = userName;
                    if (n.includes('@')) n = n.split('@')[0];
                    // strip _gmail_com, _yahoo_com, _hotmail_com etc.
                    n = n.replace(/_gmail_com$/, '').replace(/_yahoo_com$/, '').replace(/_hotmail_com$/, '').replace(/_outlook_com$/, '');
                    return n;
                  })()}
                </span>
              </div>
            </div>

            {/* Right: rewards + bell (scan moved into the search bar) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setScreen('rewards')}
                aria-label="Rewards"
                style={{
                  width: 38, height: 38, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: 'rgba(255,255,255,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Gift size={17} strokeWidth={1.8} style={{ color: 'rgba(255,255,255,0.85)' }} />
              </button>
              <button
                onClick={() => setScreen('notifications')}
                style={{
                  position: 'relative', width: 38, height: 38, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: 'rgba(255,255,255,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Bell size={17} strokeWidth={1.8} style={{ color: 'rgba(255,255,255,0.85)' }} />
                {notificationCount > 0 && (
                  <div style={{
                    position: 'absolute', top: -2, right: -2,
                    minWidth: 15, height: 15, borderRadius: 999,
                    background: '#fff', border: '2px solid #161619',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                  }}>
                    <span style={{ fontSize: 7, fontWeight: 800, color: '#0b0b0d' }}>{notificationCount}</span>
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* Balance section */}
          {isWalletReady ? (
            <div style={{ marginTop: 26 }}>
              <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.7, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Balance
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                  <span style={{ fontSize: 26, fontWeight: 700, color: '#fff' }}>{fiatSymbol}</span>
                  <span style={{ fontSize: 50, fontWeight: 800, lineHeight: 0.86, color: '#fff', letterSpacing: '-0.03em', fontFamily: 'ui-monospace, monospace' }}>
                    {balWhole}
                  </span>
                  <span style={{ fontSize: 26, fontWeight: 700, color: 'rgba(255,255,255,0.5)', fontFamily: 'ui-monospace, monospace' }}>
                    {balDec}
                  </span>
                </div>
                <button
                  onClick={() => setShowDeposit(true)}
                  style={{
                    background: '#fff', color: '#161619', border: 'none', cursor: 'pointer',
                    padding: '6px 16px', borderRadius: 999,
                    fontSize: 13, fontWeight: 800, letterSpacing: '-0.01em',
                  }}
                >
                  Add
                </button>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 700, opacity: 0.7, marginTop: 6 }}>
                {displayBalance?.toFixed(2)} USDT · ≈ {fiatLabel} {balFiat}
              </div>
            </div>
          ) : isWalletLocked ? (
            <div style={{ marginTop: 26 }}>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>
                {"Welcome back 👋"}
              </div>
              <div style={{
                fontSize: 13, fontWeight: 600, opacity: 0.8, marginTop: 7,
                lineHeight: 1.5, maxWidth: 280,
              }}>
                Your wallet is locked. Enter your PIN to see your balance and pay.
              </div>
              <button
                onClick={() => setShowWalletUnlock(true)}
                style={{
                  marginTop: 16, background: '#fff', color: '#161619', border: 'none', cursor: 'pointer',
                  padding: '13px 28px', borderRadius: 14, fontSize: 15, fontWeight: 800,
                }}
              >
                Unlock wallet
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 26 }}>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>
                {"Let's set you up 👋"}
              </div>
              <div style={{
                fontSize: 13, fontWeight: 600, opacity: 0.8, marginTop: 7,
                lineHeight: 1.5, maxWidth: 280,
              }}>
                Add money once, then send to friends, pay bills and scan any QR.
              </div>
              <button
                onClick={() => IS_EMBEDDED_WALLET ? setShowWalletSetup(true) : setShowWalletModal(true)}
                style={{
                  marginTop: 16, background: '#fff', color: '#161619', border: 'none', cursor: 'pointer',
                  padding: '13px 28px', borderRadius: 14, fontSize: 15, fontWeight: 800,
                }}
              >
                Set up wallet
              </button>
            </div>
          )}
      </div>

      {/* Scrollable body — white card pulled up over dark header */}
      <div ref={txScrollRef} style={{
        flex: 1, overflow: 'auto',
        background: '#f4f3f1',
        borderTopLeftRadius: 44, borderTopRightRadius: 44,
        marginTop: -24,
        boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
      }}>
        <div style={{ padding: '20px 22px 100px', minHeight: 380 }}>

          {/* SEARCH BAR — the text area opens the send/search (trade) flow; the
              QR pill is a SEPARATE sibling button that opens the scanner. They
              must not be nested (the QR tap used to bubble to the search button
              and just navigate to Trade instead of scanning). */}
          <div style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            padding: '16px 18px', borderRadius: 22,
            background: '#fff', border: '1px solid rgba(20,21,26,0.08)',
            boxSizing: 'border-box',
            boxShadow: '0 2px 8px rgba(20,21,26,0.06)',
          }}>
            <button
              onClick={() => setShowUpiPay(true)}
              style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12,
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              }}
            >
              <svg viewBox="0 0 24 24" width={20} height={20} fill="none"
                stroke="rgba(20,21,26,0.35)" strokeWidth="1.9" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
              </svg>
              <span style={{ flex: 1, color: 'rgba(20,21,26,0.35)', fontWeight: 700, fontSize: 14.5, textAlign: 'left' }}>
                Name, phone or UPI ID
              </span>
            </button>
            <button
              onClick={() => setShowUpiPay(true)}
              aria-label="Scan QR to pay"
              style={{
                width: 32, height: 32, borderRadius: 999, border: 'none', cursor: 'pointer',
                background: '#ffb02e', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              <ScanIcon size={17} color="#0b0b0d" />
            </button>
          </div>

          {/* FUNDED / RETURNING STATE — show if wallet is connected (even 0 balance).
              Only show new-user onboarding if wallet has never been set up. */}
          {isWalletReady ? (
            <>
              {/* StreakCoins card — exact from source */}
              <div style={{
                marginTop: 12, background: '#fff',
                border: '1px solid rgba(20,21,26,0.07)', borderRadius: 22, padding: 15,
                boxShadow: '0 2px 8px rgba(20,21,26,0.05)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                      background: 'rgba(255,176,46,0.16)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {/* PIcon.coin from source */}
                      <svg viewBox="0 0 24 24" width={21} height={21} fill="none"
                        stroke="#ffb02e" strokeWidth="1.8" strokeLinecap="round">
                        <circle cx="12" cy="12" r="8.5"/>
                        <path d="M12 7.5v9M9.3 10h3.4a1.8 1.8 0 0 1 0 3.6H9.5"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 16, fontWeight: 800, color: '#14151a', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>
                          Best rates
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8a8a90', marginTop: 1 }}>
                        beat it &amp; we match it · {fiatSymbol}{currentRate.toFixed(2)} LIVE
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => { setTradeType('buy'); setScreen('trade'); }}
                    style={{
                      background: '#ffb02e', color: '#0b0b0d', border: 'none', cursor: 'pointer',
                      padding: '9px 15px', borderRadius: 11, fontSize: 12.5, fontWeight: 800,
                    }}
                  >
                    Trade
                  </button>
                </div>
                {/* Streak dots row — from source */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 13 }}>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {[1,1,1,1,1,0,0].map((on, i) => (
                      <span key={i} style={{
                        width: 8, height: 8, borderRadius: 999,
                        background: on ? '#ffb02e' : 'rgba(20,21,26,0.12)',
                      }} />
                    ))}
                  </div>
                  <span style={{ color: '#8a8a90', fontSize: 11, fontWeight: 700 }}>2 days to a bonus 🔥</span>
                </div>
              </div>

              {/* Action chips — primary actions */}
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                {([
                  { label: 'Deposit', fn: () => setShowDeposit(true), bg: 'rgba(59,130,246,0.12)', color: '#2563eb', icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14"/></svg> },
                  { label: 'Swap', fn: () => showComingSoon(), bg: 'rgba(139,92,246,0.12)', color: '#7c3aed', icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg> },
                  { label: 'Trade', fn: () => setScreen('trade'), bg: 'rgba(255,176,46,0.15)', color: '#d97706', icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4 11 14M21 4l-6.5 17-3.5-7-7-3.5L21 4Z"/></svg> },
                  { label: 'Scan', fn: () => setShowUpiPay(true), bg: 'rgba(16,185,129,0.12)', color: '#059669', icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M3.5 12h17"/></svg> },
                ]).map(({ label, fn, icon, bg, color }) => (
                  <motion.button
                    key={label}
                    whileTap={{ scale: 0.93 }}
                    onClick={fn}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                      padding: '14px 4px 11px', borderRadius: 16, cursor: 'pointer',
                      border: '1px solid rgba(20,21,26,0.08)',
                      background: '#fff', gap: 8,
                      boxShadow: '0 1px 4px rgba(20,21,26,0.06)',
                    }}
                  >
                    <div style={{
                      width: 38, height: 38, borderRadius: 12,
                      background: bg, border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color,
                    }}>
                      {icon}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#8a8a90' }}>{label}</span>
                  </motion.button>
                ))}
              </div>

              {/* Quick links — same chip style as Deposit/Swap/Trade/Scan */}
              <div style={{ fontSize: 15.5, fontWeight: 800, color: '#14151a', marginTop: 24, marginBottom: 12 }}>Learn more</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  { label: 'Support', fn: () => setScreen('support'), icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg> },
                  { label: 'Ticket', fn: () => setScreen('support'), icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg> },
                  { label: 'Rewards', fn: () => setScreen('rewards'), icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="6"/><path d="M8 14v7l4-2 4 2v-7"/></svg> },
                  { label: 'Refer', fn: () => setScreen('rewards'), icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg> },
                ]).map(({ label, fn, icon }) => (
                  <motion.button
                    key={label}
                    whileTap={{ scale: 0.93 }}
                    onClick={fn}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                      padding: '14px 4px 11px', borderRadius: 16, cursor: 'pointer',
                      border: '1px solid rgba(20,21,26,0.08)',
                      background: '#fff', gap: 8,
                      boxShadow: '0 1px 4px rgba(20,21,26,0.06)',
                    }}
                  >
                    <div style={{
                      width: 38, height: 38, borderRadius: 12,
                      background: 'rgba(20,21,26,0.05)', border: '1px solid rgba(20,21,26,0.07)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#14151a',
                    }}>
                      {icon}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#3d3e45' }}>{label}</span>
                  </motion.button>
                ))}
              </div>

              {/* Recent trades */}
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 15.5, fontWeight: 800, color: '#14151a', marginBottom: 4 }}>Recent</div>
                {orders.length > 0 ? (
                  <>
                    {orders.slice(0, 5).map((order, i, arr) => (
                      <div key={order.id}>
                        <TxRow
                          order={order}
                          index={i}
                          onPress={() => { setActiveOrderId(order.id); setScreen('order'); }}
                        />
                        {i < arr.length - 1 && (
                          <div style={{ height: 1, background: 'rgba(20,21,26,0.07)', marginLeft: 48 }} />
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ padding: '24px 0', textAlign: 'center' }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#80828c', marginBottom: 4 }}>No transactions yet</p>
                    <p style={{ fontSize: 11, color: 'rgba(20,21,26,0.45)' }}>Your trades will appear here</p>
                  </div>
                )}
              </div>
            </>
          ) : isWalletLocked ? null : (
            /* NEW USER STATE */
            <>
              {/* Welcome bonus card */}
              <div style={{
                marginTop: 12, background: '#fff',
                border: '1px solid rgba(20,21,26,0.07)', borderRadius: 22, padding: 15,
                boxShadow: '0 2px 8px rgba(20,21,26,0.05)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                    background: 'rgba(255,176,46,0.16)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg viewBox="0 0 24 24" width={22} height={22} fill="none"
                      stroke="#ffb02e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="6" /><path d="M8 14v7l4-2 4 2v-7" />
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#14151a', letterSpacing: '-0.01em' }}>
                      Best rates — beat it &amp; we match it
                    </div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8a8a90', marginTop: 2 }}>
                      Unlocks on first payment
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
                    padding: '3px 8px', borderRadius: 999,
                    background: 'rgba(255,176,46,0.20)', color: '#ffb02e',
                  }}>NEW</span>
                </div>
                {/* Progress bar */}
                <div style={{
                  marginTop: 12, height: 4, borderRadius: 999,
                  background: 'rgba(20,21,26,0.08)', overflow: 'hidden',
                }}>
                  <div style={{ width: '10%', height: '100%', background: '#ffb02e', borderRadius: 999 }} />
                </div>
              </div>

              {/* Action chips — primary actions */}
              <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
                {([
                  { label: 'Deposit', fn: () => setShowDeposit(true), bg: 'rgba(59,130,246,0.12)', color: '#2563eb', icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14"/></svg> },
                  { label: 'Swap', fn: () => showComingSoon(), bg: 'rgba(139,92,246,0.12)', color: '#7c3aed', icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg> },
                  { label: 'Trade', fn: () => setScreen('trade'), bg: 'rgba(255,176,46,0.15)', color: '#d97706', icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4 11 14M21 4l-6.5 17-3.5-7-7-3.5L21 4Z"/></svg> },
                  { label: 'Scan', fn: () => setShowUpiPay(true), bg: 'rgba(16,185,129,0.12)', color: '#059669', icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M3.5 12h17"/></svg> },
                ]).map(({ label, fn, icon, bg, color }) => (
                  <motion.button
                    key={label}
                    whileTap={{ scale: 0.93 }}
                    onClick={fn}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                      padding: '14px 4px 11px', borderRadius: 16, cursor: 'pointer',
                      border: '1px solid rgba(20,21,26,0.08)',
                      background: '#fff', gap: 8,
                      boxShadow: '0 1px 4px rgba(20,21,26,0.06)',
                    }}
                  >
                    <div style={{
                      width: 38, height: 38, borderRadius: 12,
                      background: bg, border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color,
                    }}>
                      {icon}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#8a8a90' }}>{label}</span>
                  </motion.button>
                ))}
              </div>

              {/* Quick links — same chip style */}
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                {([
                  { label: 'Support', fn: () => setScreen('support'), icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg> },
                  { label: 'Ticket', fn: () => setScreen('support'), icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg> },
                  { label: 'Rewards', fn: () => setScreen('rewards'), icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="6"/><path d="M8 14v7l4-2 4 2v-7"/></svg> },
                  { label: 'Refer', fn: () => setScreen('rewards'), icon: <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg> },
                ]).map(({ label, fn, icon }) => (
                  <motion.button
                    key={label}
                    whileTap={{ scale: 0.93 }}
                    onClick={fn}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                      padding: '14px 4px 11px', borderRadius: 16, cursor: 'pointer',
                      border: '1px solid rgba(20,21,26,0.08)',
                      background: '#fff', gap: 8,
                      boxShadow: '0 1px 4px rgba(20,21,26,0.06)',
                    }}
                  >
                    <div style={{
                      width: 38, height: 38, borderRadius: 12,
                      background: 'rgba(20,21,26,0.05)', border: '1px solid rgba(20,21,26,0.07)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#14151a',
                    }}>
                      {icon}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#3d3e45' }}>{label}</span>
                  </motion.button>
                ))}
              </div>

              {/* Get started list */}
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 15.5, fontWeight: 800, color: '#14151a', marginBottom: 12 }}>Get started</div>
                <div style={{ borderRadius: 22, overflow: 'hidden', border: '1px solid rgba(20,21,26,0.08)', background: '#fff', boxShadow: '0 2px 8px rgba(20,21,26,0.05)' }}>
                  {[
                    {
                      icon: <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
                      label: 'Add money',
                      sub: 'Top up via UPI or bank transfer',
                      onClick: () => IS_EMBEDDED_WALLET ? setShowWalletSetup(true) : setShowWalletModal(true),
                    },
                    {
                      icon: <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 4 11 14M21 4l-6.5 17-3.5-7-7-3.5L21 4Z" /></svg>,
                      label: 'Buy USDT',
                      sub: 'Best rate, instantly settled',
                      onClick: () => { setTradeType('buy'); setScreen('trade'); },
                    },
                    {
                      icon: <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 11h16v9H4zM2.5 7.5h19V11h-19zM12 7.5V20" /></svg>,
                      label: 'Invite & earn',
                      sub: 'Refer a friend and get rewarded',
                      onClick: () => setScreen('profile'),
                    },
                  ].map((item, i) => (
                    <motion.button
                      key={item.label}
                      whileTap={{ scale: 0.98 }}
                      onClick={item.onClick}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                        padding: '14px 16px',
                        background: 'transparent',
                        borderTop: i > 0 ? '1px solid rgba(20,21,26,0.07)' : 'none',
                        border: 'none', cursor: 'pointer', textAlign: 'left',
                        boxSizing: 'border-box',
                      }}
                    >
                      <div style={{
                        width: 38, height: 38, borderRadius: 12, flexShrink: 0,
                        background: 'rgba(20,21,26,0.05)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#565862',
                      }}>
                        {item.icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 13.5, color: '#14151a' }}>{item.label}</div>
                        <div style={{ color: '#8a8a90', fontSize: 11.5, fontWeight: 600, marginTop: 1 }}>{item.sub}</div>
                      </div>
                      <ChevronRight size={14} strokeWidth={2} style={{ color: 'rgba(20,21,26,0.25)', flexShrink: 0 }} />
                    </motion.button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* BOTTOM NAV — shared component so every user screen matches.
          Inbox carries the chat-unread badge; Rewards now lives in the
          top header above. */}
      {!hideBottomNav && (
        <BottomNav
          screen={screen}
          setScreen={setScreen}
          maxW={maxW}
          chatUnreadCount={unreadCount}
        />
      )}

      {/* ── UPI Pay (QR scan → amount → hand off to escrow flow) ── */}
      {showUpiPay && (
        <UpiPayScreen
          onClose={() => setShowUpiPay(false)}
          currentRate={currentRate}
          usdtBalance={IS_MOCK_MODE ? (userBalance ?? null) : solanaWallet.usdtBalance}
          walletReady={isWalletReady}
          walletCta={(() => {
            // Close the scanner first so the wallet modal (rendered at the
            // page level, below this z-[100] overlay) is visible, then open
            // the right flow for the wallet's current state. Mirrors the
            // EscrowLockScreen onConnectWallet handler in page.tsx.
            const close = () => setShowUpiPay(false);
            if (IS_EMBEDDED_WALLET && embeddedWallet) {
              if (embeddedWallet.state === 'none')
                return { label: 'Set up wallet', onClick: () => { close(); setShowWalletSetup(true); } };
              if (embeddedWallet.state === 'locked')
                return { label: 'Unlock wallet', onClick: () => { close(); setShowWalletUnlock(true); } };
            }
            return { label: 'Connect wallet', onClick: () => { close(); setShowWalletModal(true); } };
          })()}
          onConfirm={(data) => {
            setShowUpiPay(false);
            onUpiPayConfirm?.(data);
          }}
        />
      )}

      {/* ── Deposit / Receive — bottom sheet ── */}
      <AnimatePresence>
        {showDeposit && (
          <>
            <motion.div
              key="deposit-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setShowDeposit(false)}
              style={{
                // zIndex 55: above the BottomNav (z-50) so the nav is dimmed
                // behind the backdrop while the deposit sheet is open.
                position: 'fixed', inset: 0, zIndex: 55,
                background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
              }}
            />
            <motion.div
              key="deposit-sheet"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              style={{
                // zIndex 60: above the BottomNav (z-50) so the sheet (and its
                // copy button) sit on top of the nav instead of behind it.
                position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60,
                padding: '0 12px', paddingBottom: 'calc(env(safe-area-inset-bottom, 12px) + 16px)',
              }}
            >
              <div
                // Tablet: widen the deposit sheet to match the 720px column
                // (md:) instead of a 440px card stranded in the middle. mx-auto
                // keeps it centred; phone stays 440 via the base cap.
                className="w-full max-w-[440px] md:max-w-[720px] mx-auto"
                style={{
                padding: '18px 20px 22px',
                borderRadius: 28, background: 'var(--color-surface-card)',
                border: '1px solid var(--color-border-subtle)',
                backdropFilter: 'blur(28px)',
                boxShadow: '0 -20px 50px -10px rgba(0,0,0,0.35)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <span style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--color-border-medium)', display: 'block' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)' }}>Receive USDT</h2>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginTop: 2 }}>Solana network · SPL token</p>
                  </div>
                  <button onClick={() => setShowDeposit(false)} style={{
                    width: 30, height: 30, borderRadius: 999, border: 'none', cursor: 'pointer',
                    background: 'var(--color-surface-active)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <X size={14} strokeWidth={2.4} style={{ color: 'var(--color-text-secondary)' }} />
                  </button>
                </div>
                <div style={{
                  width: 232, height: 232, padding: 14, borderRadius: 24, background: '#fff',
                  margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 16px 36px -12px rgba(0,0,0,0.25)',
                  border: '1px solid var(--color-border-subtle)',
                }}>
                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrDataUrl} alt="Wallet QR" style={{ width: '100%', height: '100%' }} />
                  ) : (
                    <Loader2 size={20} style={{ color: 'rgba(15,23,42,0.45)', animation: 'spin 1s linear infinite' }} />
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', marginTop: 20, gap: 8 }}>
                  <div style={{
                    flex: 1, padding: '11px 14px', borderRadius: 14, minWidth: 0,
                    background: 'var(--color-surface-base)', border: '1px solid var(--color-border-subtle)',
                  }}>
                    <span style={{
                      display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)',
                      fontFamily: 'ui-monospace, monospace',
                    }}>
                      {solanaWallet.walletAddress || '—'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      const addr = solanaWallet.walletAddress;
                      if (!addr) return;
                      try { navigator.clipboard?.writeText(addr); } catch {}
                      setDepositCopied(true);
                      setTimeout(() => setDepositCopied(false), 1800);
                    }}
                    style={{
                      width: 44, height: 44, borderRadius: 14, border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: depositCopied ? 'rgba(16,185,129,0.18)' : 'var(--color-text-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {depositCopied
                      ? <Check size={16} strokeWidth={2.6} style={{ color: 'var(--color-success)' }} />
                      : <Copy size={15} strokeWidth={2.4} style={{ color: 'var(--color-surface-base)' }} />}
                  </button>
                </div>
                <p style={{
                  textAlign: 'center', fontSize: 10.5, fontWeight: 600,
                  color: 'var(--color-text-secondary-strong)', marginTop: 14, lineHeight: 1.4,
                }}>
                  Send only USDT (SPL) on Solana. Other tokens or networks will be lost.
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── "Coming soon" toast ── shown when a not-yet-shipped action
          (e.g. Request) is tapped. Auto-dismisses. */}
      <AnimatePresence>
        {comingSoon && (
          <motion.div
            key="coming-soon-toast"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            style={{
              position: 'fixed', left: 0, right: 0, zIndex: 200,
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)',
              display: 'flex', justifyContent: 'center', padding: '0 24px',
              pointerEvents: 'none',
            }}
          >
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '11px 18px', borderRadius: 999,
              background: 'rgba(20,21,26,0.92)', backdropFilter: 'blur(10px)',
              color: '#fff', fontSize: 13, fontWeight: 700,
              boxShadow: '0 10px 30px -8px rgba(0,0,0,0.5)',
            }}>
              <Clock size={15} strokeWidth={2.2} />
              Request is coming soon
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
