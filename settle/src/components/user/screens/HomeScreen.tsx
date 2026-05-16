"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Bug,
  ArrowUpRight,
  ArrowDownLeft,
  Zap,
  QrCode,
  Download,
  Activity,
  ChevronRight,
  Copy,
  Check,
  ShieldCheck,
  ExternalLink,
  X,
  Loader2,
} from "lucide-react";
import * as QRCode from "qrcode";
import { UpiPayScreen } from "@/components/user/UpiPayScreen";
import { openIssueReporter } from "@/components/IssueReporter";
import { useState as useStateHook, useEffect } from "react";
import { ConnectionIndicator } from "@/components/NotificationToast";
import { showAlert } from "@/context/ModalContext";
import { BottomNav } from "./BottomNav";
import type { Screen, Order } from "./types";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';
const IS_MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

const SECTION_LABEL = "text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase";

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
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Single transaction row ────────────────────────────────────────────────
function TxRow({ order, index, onPress, avatarUrl }: { order: Order; index: number; onPress: () => void; avatarUrl?: string }) {
  const isBuy = order.type === 'buy';
  const amount = parseFloat(order.fiatAmount);
  const isActive = order.status !== 'complete';

  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onPress}
      className="w-full flex items-center gap-3 text-left py-[10px]"
    >
      {/* Avatar — compact */}
      <div className="relative shrink-0 w-9 h-9 rounded-[12px] overflow-hidden bg-surface-raised border border-border-subtle">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={order.merchant.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[14px] font-bold text-text-primary">
              {order.merchant.name?.charAt(0)?.toUpperCase() ?? 'T'}
            </span>
          </div>
        )}
        {isActive && (
          <motion.div
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.4, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-success border-2 border-surface-base"
          />
        )}
      </div>

      {/* Name + date — compact */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-text-primary tracking-[-0.005em] mb-[1px]">
          {isBuy ? 'Buy USDT' : 'Sell USDT'}
        </p>
        <p className="text-[10px] font-medium text-text-tertiary">
          {order.merchant.name} · {formatDate(order.createdAt)}
        </p>
      </div>

      {/* Amount — compact, color-coded (Apple Stocks: green/red signed) */}
      <div className="text-right shrink-0">
        <p
          className="text-[13px] font-semibold tracking-[-0.01em] font-mono"
          style={{ color: isBuy ? '#DC2626' : '#059669' }}
        >
          {isBuy ? '-' : '+'}{order.fiatCode === 'INR' ? '₹' : order.fiatCode === 'USD' ? '$' : 'د.إ'}{amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
        <p className="text-[10px] font-medium text-text-tertiary mt-0.5 font-mono">
          {parseFloat(order.cryptoAmount).toFixed(2)} USDT
        </p>
      </div>
    </motion.button>
  );
}

// ─── Wallet balance + chart + actions ───────────────────────────────────
function WalletBalanceSection({
  displayBalance, isWalletReady,
  solanaWallet, embeddedWallet, completedOrders, currentRate, selectedPair,
  setShowWalletModal, setShowWalletSetup, setShowWalletUnlock,
  setTradeType, setScreen, onDeposit, onPay,
}: {
  displayBalance: number | null;
  isWalletReady: boolean;
  solanaWallet: { connected: boolean; walletAddress: string | null; usdtBalance: number | null; solBalance?: number | null; usdcBalance?: number | null };
  embeddedWallet?: { state: 'none' | 'locked' | 'unlocked' };
  completedOrders: Order[];
  currentRate: number;
  selectedPair?: 'usdt_aed' | 'usdt_inr';
  setShowWalletModal: (v: boolean) => void;
  setShowWalletSetup: (v: boolean) => void;
  setShowWalletUnlock: (v: boolean) => void;
  setTradeType: (t: 'buy' | 'sell') => void;
  setScreen: (s: Screen) => void;
  onDeposit: () => void;
  onPay: () => void;
}) {
  // Currency label tracks the active corridor (defaults to INR — see useUserTradeCreation).
  const fiatLabel = selectedPair === 'usdt_aed' ? 'AED' : 'INR';

  // TODO(balance-history): build /api/users/[id]/balance-history that reads
  // from ledger_entries grouped by day for the last 7 days, then render a
  // real sparkline here with real daily P&L. Removed the static placeholders
  // (hardcoded +$557 / +3.6% / fake ascending chart) because showing fake
  // financial data to real users is misleading and not acceptable for a
  // fintech product.

  // Hard-coded white text for the dark hero — these must NOT be flipped by
  // .user-light overrides since the hero stays dark regardless of theme.
  const heroText = {
    hi: 'rgba(255,255,255,0.96)',
    md: 'rgba(255,255,255,0.55)',
    lo: 'rgba(255,255,255,0.32)',
  };

  // ── Token deck — main USDT balance is index 0, swipe-equivalent via page dots
  const tokens = [
    { symbol: 'USDT', name: 'Tether',   amount: displayBalance,                 dp: 2, color: '#26A17B', hasRate: true  },
    { symbol: 'SOL',  name: 'Solana',   amount: solanaWallet.solBalance ?? null, dp: 4, color: '#9945FF', hasRate: false },
    { symbol: 'USDC', name: 'USD Coin', amount: solanaWallet.usdcBalance ?? null, dp: 2, color: '#2775CA', hasRate: true  },
  ] as const;
  const [tokenIdx, setTokenIdx] = useStateHook(0);
  const t = tokens[tokenIdx];
  const tBal = t.amount ?? 0;
  const tWhole = Math.floor(tBal).toLocaleString('en-US');
  const tDec = (tBal % 1).toFixed(t.dp).slice(1) || `.${'0'.repeat(t.dp)}`;
  const tFiat = t.hasRate
    ? (tBal * currentRate).toLocaleString('en-US', { maximumFractionDigits: 2 })
    : null;

  return (
    <>
      {/* ── Centered live-rate pill (Phantom-style) ── */}
      <div className="flex items-center justify-center mb-2">
        <div
          className="flex items-center gap-1.5"
          style={{
            padding: '5px 10px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <motion.div
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.8, repeat: Infinity }}
            style={{
              width: 5, height: 5, borderRadius: 999,
              background: '#10b981',
              boxShadow: '0 0 6px rgba(16,185,129,0.55)',
            }}
          />
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
            color: heroText.md,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            {currentRate.toFixed(2)} {fiatLabel}
          </span>
        </div>
      </div>

      {/* ── Big centered balance + Apple-style page-dot token switcher ── */}
      {isWalletReady ? (
        <div style={{ marginTop: 20, marginBottom: 8, textAlign: 'center' }}>
          <motion.div
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              const OFFSET = 50;
              const VELOCITY = 350;
              const swipedLeft = info.offset.x < -OFFSET || info.velocity.x < -VELOCITY;
              const swipedRight = info.offset.x > OFFSET || info.velocity.x > VELOCITY;
              if (swipedLeft) setTokenIdx((i) => Math.min(i + 1, tokens.length - 1));
              else if (swipedRight) setTokenIdx((i) => Math.max(i - 1, 0));
            }}
            style={{ touchAction: 'pan-y', cursor: 'grab' }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={t.symbol}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="flex items-baseline justify-center" style={{ gap: 2 }}>
                  <span style={{
                    fontSize: 60, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1,
                    color: heroText.hi,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}>
                    {tWhole}
                  </span>
                  <span style={{
                    fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1,
                    color: heroText.lo,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}>
                    {tDec}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                    color: heroText.lo, marginLeft: 8,
                  }}>
                    {t.symbol}
                  </span>
                </div>
                <p style={{
                  fontSize: 12, fontWeight: 600,
                  color: heroText.md,
                  marginTop: 12, letterSpacing: '-0.005em',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}>
                  {tFiat ? `≈ ${tFiat} ${fiatLabel}` : t.name}
                </p>
              </motion.div>
            </AnimatePresence>
          </motion.div>

          {/* ── Page-dot indicator (iOS-style) ── */}
          <div className="flex items-center justify-center" style={{ gap: 6, marginTop: 18 }}>
            {tokens.map((tk, i) => {
              const active = i === tokenIdx;
              return (
                <button
                  key={tk.symbol}
                  type="button"
                  onClick={() => setTokenIdx(i)}
                  aria-label={`Show ${tk.name} balance`}
                  style={{
                    height: 6,
                    width: active ? 18 : 6,
                    borderRadius: 999,
                    background: active ? tk.color : 'rgba(255,255,255,0.22)',
                    boxShadow: active ? `0 0 8px ${tk.color}55` : undefined,
                    transition: 'width 280ms cubic-bezier(0.22,1,0.36,1), background 280ms ease',
                    border: 0,
                    padding: 0,
                  }}
                />
              );
            })}
          </div>

        </div>
      ) : (
        <div className="flex flex-col items-center gap-3" style={{ textAlign: 'center', marginTop: 18 }}>
          <span style={{
            fontSize: 60, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1,
            color: 'rgba(255,255,255,0.18)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            ——
          </span>
          <p style={{ fontSize: 13, color: heroText.md, lineHeight: 1.5 }}>
            {IS_EMBEDDED_WALLET
              ? embeddedWallet?.state === 'locked' ? 'Unlock your wallet to view balance' : 'Set up a wallet to start trading'
              : 'Connect your Solana wallet to trade'}
          </p>
          <motion.button whileTap={{ scale: 0.96 }}
            onClick={() => {
              if (IS_EMBEDDED_WALLET) {
                if (embeddedWallet?.state === 'locked') setShowWalletUnlock(true);
                else setShowWalletSetup(true);
              } else { setShowWalletModal(true); }
            }}
            style={{
              padding: '10px 22px', borderRadius: 14,
              background: '#ffffff', color: '#0B0F14',
              fontSize: 14, fontWeight: 800, letterSpacing: '-0.005em',
            }}>
            {IS_EMBEDDED_WALLET
              ? embeddedWallet?.state === 'locked' ? 'Unlock Wallet' : 'Create Wallet'
              : 'Connect Wallet'}
          </motion.button>
        </div>
      )}

      {/* ── Action buttons — bigger Phantom-style square tiles ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
        className="grid grid-cols-4 gap-2.5"
        style={{ marginTop: 12 }}
      >
        {([
          { label: 'Pay',      Icon: QrCode,        primary: false, comingSoon: false, fn: onPay },
          { label: 'Buy',      Icon: ArrowDownLeft, primary: true,  comingSoon: false, fn: () => { setTradeType('buy');  setScreen('trade'); } },
          { label: 'Sell',     Icon: ArrowUpRight,  primary: true,  comingSoon: false, fn: () => { setTradeType('sell'); setScreen('trade'); } },
          { label: 'Deposit',  Icon: Download,      primary: false, comingSoon: false, fn: onDeposit },
        ] as const).map(({ label, Icon, primary, comingSoon, fn }) => (
          <motion.button key={label} whileTap={{ scale: 0.93 }} onClick={fn}
            className="relative flex flex-col items-center justify-center gap-1 cursor-pointer min-w-0"
            style={{
              // Padding scales with viewport so 4 tiles + 3 gaps always fit
              // a small phone (~320px) without overflow, and grow up on
              // wider devices.
              padding: 'clamp(10px, 3.2vw, 14px) clamp(4px, 1.5vw, 8px)',
              borderRadius: 18,
              background: primary
                ? 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(235,235,240,0.92))'
                : 'rgba(255,255,255,0.05)',
              border: primary
                ? '1px solid rgba(255,255,255,0.55)'
                : '1px solid rgba(255,255,255,0.08)',
              boxShadow: primary
                ? '0 8px 22px -10px rgba(255,255,255,0.30), inset 0 1px 0 rgba(255,255,255,0.85)'
                : 'inset 0 1px 0 rgba(255,255,255,0.04)',
              opacity: comingSoon ? 0.55 : 1,
            }}
          >
            <Icon size={20} strokeWidth={2.2}
              style={{ color: primary ? '#0B0F14' : 'rgba(255,255,255,0.92)' }} />
            <span
              className="truncate max-w-full"
              style={{
                fontSize: 'clamp(10px, 2.8vw, 12px)',
                fontWeight: 700, letterSpacing: '-0.005em',
                color: primary ? '#0B0F14' : 'rgba(255,255,255,0.78)',
              }}
            >
              {label}
            </span>
            {comingSoon && (
              <span style={{
                position: 'absolute', top: 6, right: 6,
                padding: '1px 5px', borderRadius: 999,
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.16)',
                fontSize: 7, fontWeight: 800, letterSpacing: '0.06em',
                color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase',
              }}>Soon</span>
            )}
          </motion.button>
        ))}
      </motion.div>

      {/* ── Beat Any Rate — full-width Apple Card titanium row ── */}
      <motion.a
        href="https://blip.money/rates"
        target="_blank"
        rel="noopener noreferrer"
        whileTap={{ scale: 0.985 }}
        className="relative flex items-center w-full overflow-hidden"
        style={{
          marginTop: 18,
          gap: 12,
          padding: '13px 16px 13px 14px',
          borderRadius: 20,
          // Brushed-titanium: layered radial sheens over a silver-gray gradient
          background: [
            'radial-gradient(at 12% 0%, rgba(255, 230, 240, 0.55) 0%, transparent 45%)',
            'radial-gradient(at 90% 100%, rgba(180, 220, 255, 0.55) 0%, transparent 50%)',
            'linear-gradient(135deg, #E5E7EB 0%, #C7CBD2 35%, #E8EAEE 60%, #B7BBC2 100%)',
          ].join(', '),
          border: '1px solid rgba(255,255,255,0.55)',
          boxShadow: [
            '0 18px 34px -14px rgba(15,23,42,0.55)',
            '0 6px 12px -6px rgba(15,23,42,0.30)',
            'inset 0 1px 0 rgba(255,255,255,0.85)',
            'inset 0 -1px 0 rgba(15,23,42,0.10)',
          ].join(', '),
          textDecoration: 'none',
        }}
      >
        {/* Brushed-metal vertical grain */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: 'inherit',
            opacity: 0.35,
            mixBlendMode: 'soft-light',
            background:
              'repeating-linear-gradient(90deg, rgba(255,255,255,0.20) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(15,23,42,0.05) 0 1px, transparent 1px 4px)',
          }}
        />
        {/* Specular top sheen */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: 'inherit',
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.10) 38%, transparent 60%)',
          }}
        />
        {/* Embossed shield medallion */}
        <div
          className="relative flex items-center justify-center shrink-0"
          style={{
            width: 32, height: 32, borderRadius: 10,
            background: 'linear-gradient(135deg, #1A1F2C 0%, #0B0F17 100%)',
            border: '1px solid rgba(255,255,255,0.55)',
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.22), 0 2px 4px rgba(0,0,0,0.22)',
          }}
        >
          <ShieldCheck size={15} strokeWidth={2.6} style={{ color: '#E8B66A' }} />
        </div>

        {/* Title + subtitle */}
        <div className="relative flex-1 min-w-0 flex flex-col" style={{ lineHeight: 1.15 }}>
          <div className="flex items-center gap-2">
            <span style={{
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: '-0.01em',
              color: '#0B0F14',
            }}>
              Beat any rate
            </span>
            {/* Live tag — adds color hint without being loud */}
            <span
              className="flex items-center gap-1"
              style={{
                padding: '2px 6px',
                borderRadius: 999,
                background: 'rgba(5,150,105,0.14)',
                border: '1px solid rgba(5,150,105,0.32)',
              }}
            >
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.8, repeat: Infinity }}
                style={{
                  width: 4, height: 4, borderRadius: 999,
                  background: '#059669',
                  boxShadow: '0 0 4px rgba(5,150,105,0.65)',
                }}
              />
              <span style={{
                fontSize: 8.5,
                fontWeight: 800,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                color: '#04785A',
              }}>
                Live
              </span>
            </span>
          </div>
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '-0.005em',
            color: 'rgba(15,23,42,0.62)',
            marginTop: 2,
          }}>
            Compared across exchanges &middot; we&rsquo;ll match it
          </span>
        </div>

        {/* Trailing external-link arrow */}
        <div
          className="relative flex items-center justify-center shrink-0"
          style={{
            width: 26, height: 26, borderRadius: 999,
            background: 'rgba(15,23,42,0.06)',
            border: '1px solid rgba(15,23,42,0.10)',
          }}
        >
          <ExternalLink size={12} strokeWidth={2.6} style={{ color: 'rgba(15,23,42,0.75)' }} />
        </div>
      </motion.a>
    </>
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
  onUpiPayConfirm,
}: HomeScreenProps) => {
  const displayBalance = IS_MOCK_MODE ? (userBalance ?? 0) : solanaWallet.usdtBalance;
  const isWalletReady = IS_MOCK_MODE ? (userBalance !== undefined && userBalance !== null) : solanaWallet.connected;

  // Only count unread on non-terminal orders. Terminal orders (completed /
  // cancelled / expired) can retain is_read=false rows if the user never
  // reopened the chat, which would otherwise inflate the nav badge forever.
  const TERMINAL_STATUSES = ['completed', 'cancelled', 'expired'];
  const unreadCount = orders.reduce(
    (s, o) => s + (TERMINAL_STATUSES.includes(String(o.dbStatus)) ? 0 : (o.unreadCount || 0)),
    0,
  );
  const [navCopied, setNavCopied] = useStateHook(false);
  const [cardH, setCardH] = useStateHook<number | null>(null);
  // ── Deposit / Receive modal ──
  const [showDeposit, setShowDeposit] = useStateHook(false);
  const [showUpiPay, setShowUpiPay] = useStateHook(false);
  const [qrDataUrl, setQrDataUrl] = useStateHook<string | null>(null);
  const [depositCopied, setDepositCopied] = useStateHook(false);
  useEffect(() => {
    if (!showDeposit || !solanaWallet.walletAddress) return;
    QRCode.toDataURL(solanaWallet.walletAddress, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
      color: { dark: "#0B0F14", light: "#FFFFFF" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [showDeposit, solanaWallet.walletAddress]);
  useEffect(() => {
    setCardH(Math.round(window.innerHeight * 0.5));
  }, []);
  function copyNavWallet() {
    const addr = solanaWallet.walletAddress;
    if (!addr) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(addr).then(() => {
          setNavCopied(true);
          setTimeout(() => setNavCopied(false), 2000);
        }).catch(() => fallbackCopy(addr));
      } else {
        fallbackCopy(addr);
      }
    } catch { fallbackCopy(addr); }
  }
  function fallbackCopy(text: string) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.focus(); el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    setNavCopied(true);
    setTimeout(() => setNavCopied(false), 2000);
  }

  return (
    <div
      className="relative flex flex-col h-[100dvh] overflow-hidden"
      // Match the hero's terminal gradient so the body section visually
      // blends with the dark card above, rather than showing white gap
      // between content end and the bottom nav.
      style={{ background: '#07090F' }}
    >

      {/* ══════════════════════════════════════════════
          HERO CARD — premium dark "card" surface,
          stays dark in BOTH themes, curved bottom rests on white body.
          Always 60svh tall — body below gets the remaining 40svh.
         ══════════════════════════════════════════════ */}
      <div
        className="relative shrink-0 pb-3"
        style={{
          background: 'linear-gradient(180deg, #161B26 0%, #0B0F17 55%, #07090F 100%)',
          borderBottomLeftRadius: 44,
          borderBottomRightRadius: 44,
          boxShadow:
            '0 30px 40px -28px rgba(0,0,0,0.45), 0 18px 22px -16px rgba(0,0,0,0.30)',
          // Adapts to device — shorter on small phones, leaves room for body
          // + bottom nav without an awkward whitespace gap. `clamp` floors at
          // 480px (small phones) and caps at 60svh (tablets / large phones).
          minHeight: 'clamp(480px, 56svh, 60svh)',
        }}
      >

        {/* ── Ambient decorations ── */}
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ borderBottomLeftRadius: 44, borderBottomRightRadius: 44 }}
        >
          {/* Soft top-edge highlight (Apple-style edge) */}
          <div
            className="absolute top-0 left-0 right-0"
            style={{
              height: 1,
              background:
                'linear-gradient(90deg, transparent, rgba(255,255,255,0.18) 25%, rgba(255,255,255,0.18) 75%, transparent)',
            }}
          />

          {/* Accent glow top-left */}
          <div
            className="absolute -top-[20%] -left-[15%] w-[65%] h-[65%] blur-[60px]"
            style={{ background: 'radial-gradient(ellipse, rgba(255,255,255,0.10) 0%, transparent 65%)' }}
          />

          {/* Subtle emerald glow lower-right (mirrors live-rate dot) */}
          <div
            className="absolute -bottom-[10%] -right-[12%] w-[55%] h-[55%] blur-[55px]"
            style={{ background: 'radial-gradient(ellipse, rgba(16,185,129,0.08) 0%, transparent 65%)' }}
          />

          {/* Dot grid */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px)',
              backgroundSize: '26px 26px',
            }}
          />
        </div>

        {/* ── Header ── */}
        <div className={`${maxW} mx-auto relative z-10 px-6 pt-4`}>
          <div className="flex items-center justify-between mb-4">

            {/* Avatar + name + wallet — white text locked in for dark hero */}
            <div className="flex items-center gap-3">
              <motion.button whileTap={{ scale: 0.92 }} onClick={() => setScreen('profile')}>
                <div
                  className="relative w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: '#ffffff' }}
                >
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#0B0F14' }}>
                    {(userName || 'U').charAt(0).toUpperCase()}
                  </span>
                </div>
              </motion.button>
              <div className="flex flex-col gap-0.5">
                <span style={{
                  fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em',
                  color: 'rgba(255,255,255,0.96)',
                }}>
                  {userName}
                </span>
                {solanaWallet.walletAddress && (
                  <div className="flex items-center gap-1.5">
                    <span style={{
                      fontSize: 10, letterSpacing: '0.04em',
                      color: 'rgba(255,255,255,0.42)',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}>
                      {solanaWallet.walletAddress.slice(0, 6)}…{solanaWallet.walletAddress.slice(-6)}
                    </span>
                    <motion.button whileTap={{ scale: 0.88 }} onClick={copyNavWallet}
                      className="flex items-center justify-center"
                      style={{
                        width: 18, height: 18, borderRadius: 5,
                        background: navCopied ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.06)',
                        border: navCopied ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(255,255,255,0.10)',
                      }}>
                      {navCopied
                        ? <Check size={9} style={{ color: '#10b981' }} />
                        : <Copy size={9} style={{ color: 'rgba(255,255,255,0.55)' }} />}
                    </motion.button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={() => void openIssueReporter()}
                aria-label="Report Issue"
                title="Report Issue"
                className="flex items-center justify-center"
                style={{
                  width: 38, height: 38, borderRadius: 13,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)',
                }}
              >
                <Bug size={17} strokeWidth={1.8} style={{ color: 'rgba(255,255,255,0.65)' }} />
              </motion.button>

              <motion.button whileTap={{ scale: 0.88 }} onClick={() => setScreen('notifications')}
                className="relative flex items-center justify-center"
                style={{
                  width: 38, height: 38, borderRadius: 13,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)',
                }}>
                <Bell size={17} strokeWidth={1.8} style={{ color: 'rgba(255,255,255,0.65)' }} />
                {notificationCount > 0 && (
                  <div
                    className="absolute -top-[3px] -right-[3px] flex items-center justify-center"
                    style={{
                      minWidth: 15, height: 15, padding: '0 4px', borderRadius: 999,
                      background: '#ffffff', border: '2px solid #0B0F17',
                    }}
                  >
                    <span style={{ fontSize: 7, fontWeight: 800, color: '#0B0F14' }}>
                      {notificationCount}
                    </span>
                  </div>
                )}
              </motion.button>
            </div>
          </div>

          {/* ── Balance section ── */}
          <div className="mt-4" />
          <WalletBalanceSection
            displayBalance={displayBalance}
            isWalletReady={isWalletReady}
            solanaWallet={solanaWallet}
            embeddedWallet={embeddedWallet}
            completedOrders={completedOrders}
            currentRate={currentRate}
            selectedPair={selectedPair}
            setShowWalletModal={setShowWalletModal}
            setShowWalletSetup={setShowWalletSetup}
            setShowWalletUnlock={setShowWalletUnlock}
            setTradeType={setTradeType}
            setScreen={setScreen}
            onDeposit={() => setShowDeposit(true)}
            onPay={() => setShowUpiPay(true)}
          />

          {/* ── Circle (trading partners) — lives inside the dark hero ── */}
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: '0.22em',
                color: 'rgba(255,255,255,0.32)', textTransform: 'uppercase',
              }}>
                Circle
              </span>
            </div>
            {orders.length === 0 ? (
              <p style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.32)' }}>
                No trading partners yet
              </p>
            ) : (
              <div className="flex gap-3 overflow-x-auto no-scrollbar -ml-1 px-1">
                {(() => {
                  const seen = new Set<string>();
                  return orders.filter(o => { if (seen.has(o.merchant.id)) return false; seen.add(o.merchant.id); return true; }).slice(0, 6);
                })().map((order, i) => {
                  const isActive = order.status !== 'complete' && order.status !== 'cancelled' && order.status !== 'expired';
                  const initial = order.merchant.name?.charAt(0)?.toUpperCase() ?? '?';
                  return (
                    <motion.div key={order.merchant.id}
                      initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.18 + i * 0.06 }}
                      whileTap={{ scale: 0.93 }} className="flex flex-col items-center gap-1.5 shrink-0">
                      <div className="relative">
                        <div
                          style={{
                            padding: 2, borderRadius: 22,
                            border: '1.5px solid rgba(255,255,255,0.12)',
                          }}
                        >
                          <div
                            className="flex items-center justify-center"
                            style={{
                              width: 48, height: 48, borderRadius: 17,
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.08)',
                            }}
                          >
                            <span style={{ fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.92)' }}>
                              {initial}
                            </span>
                          </div>
                        </div>
                        {isActive && (
                          <motion.div animate={{ scale: [1, 1.35, 1] }} transition={{ duration: 2, repeat: Infinity }}
                            className="absolute -bottom-[3px] -right-[3px] flex items-center justify-center"
                            style={{
                              width: 14, height: 14, borderRadius: 999,
                              background: '#10b981', border: '2px solid #0B0F17',
                            }}>
                            <Zap size={6} className="fill-current" style={{ color: '#ffffff' }} />
                          </motion.div>
                        )}
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        color: 'rgba(255,255,255,0.42)',
                      }}>
                        {order.merchant.name?.split(' ')?.[0] ?? 'Trader'}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>


      {/* ══════════════════════════════════════════════
          TRANSACTIONS SECTION — always white, regardless
          of the user's dark/light theme. Locks light-mode
          token values via CSS variables so existing
          `text-text-primary` / `bg-surface-*` / `border-border-*`
          utilities inside resolve to dark-on-white tokens.
         ══════════════════════════════════════════════ */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.18, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 min-h-0 relative z-10 pb-24 overflow-y-auto no-scrollbar"
        style={{
          background: '#ffffff',
          // ── Force light tokens locally — overrides .user-scope (dark) tokens
          ['--color-surface-base' as any]: '#ffffff',
          ['--color-surface-raised' as any]: '#f7f8fa',
          ['--color-surface-overlay' as any]: '#eef0f3',
          ['--color-surface-card' as any]: 'rgba(15,23,42,0.035)',
          ['--color-surface-hover' as any]: 'rgba(15,23,42,0.055)',
          ['--color-surface-active' as any]: 'rgba(15,23,42,0.075)',
          ['--color-text-primary' as any]: 'rgba(15,23,42,0.95)',
          ['--color-text-secondary' as any]: 'rgba(15,23,42,0.60)',
          ['--color-text-tertiary' as any]: 'rgba(15,23,42,0.42)',
          ['--color-text-quaternary' as any]: 'rgba(15,23,42,0.20)',
          ['--color-border-subtle' as any]: 'rgba(15,23,42,0.06)',
          ['--color-border-medium' as any]: 'rgba(15,23,42,0.10)',
          ['--color-border-strong' as any]: 'rgba(15,23,42,0.16)',
          ['--color-success' as any]: '#059669',
          ['--color-success-dim' as any]: 'rgba(5,150,105,0.10)',
          ['--color-success-border' as any]: 'rgba(5,150,105,0.28)',
          ['--accent' as any]: '#0f172a',
          ['--accent-text' as any]: '#ffffff',
        }}
      >
        <div className={`${maxW} mx-auto px-5 pt-2`}>

          {/* Section title — kept small to focus attention on the card above */}
          <div className="flex items-center justify-between ">
            <h2 className="text-[13px] font-bold text-text-secondary tracking-[-0.01em]">
              Transactions
            </h2>
            {orders.length > 0 && (
              <motion.button whileTap={{ scale: 0.94 }} onClick={() => setScreen('orders')}
                className="flex items-center gap-0.5 text-[11px] font-semibold text-text-tertiary">
                See all <ChevronRight size={12} strokeWidth={2} className="mt-px" />
              </motion.button>
            )}
          </div>

          {/* Pending order alert */}
          {pendingOrders.length > 0 && (
            <motion.button
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                const o = pendingOrders[0];
                setActiveOrderId(o.id);
                if (o.status === 'pending') {
                  setPendingTradeData({ amount: o.cryptoAmount, fiatAmount: o.fiatAmount, type: o.type, paymentMethod: o.merchant.paymentMethod });
                  setScreen('matching');
                } else { setScreen('order'); }
              }}
              className="w-full flex items-center gap-3 text-left rounded-[18px] mt-3 mb-1 py-[13px] px-[15px] bg-surface-hover border border-border-strong"
            >
              <motion.div animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
                className="w-[7px] h-[7px] rounded-full bg-accent shrink-0" />
              <div className="flex-1">
                <p className="text-[14px] font-bold text-text-primary mb-0.5 tracking-[-0.01em]">
                  {pendingOrders[0].type === 'buy' ? 'Buying' : 'Selling'} {parseFloat(pendingOrders[0].cryptoAmount).toFixed(2)} USDT
                </p>
                <p className="text-[11px] text-text-tertiary font-medium">
                  {pendingOrders[0].status === 'pending' ? 'Finding merchant...' : `Step ${pendingOrders[0].step} of 4 · Tap to continue`}
                </p>
              </div>
              <ChevronRight size={17} strokeWidth={2} className="text-text-tertiary shrink-0" />
            </motion.button>
          )}

          {/* Transaction rows */}
          {orders.length > 0 ? (
            <div className="mt-2">
              {orders.slice(0, 8).map((order, i, arr) => (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.07, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                >
                  <TxRow
                    order={order}
                    index={i}
                    onPress={() => {
                      setActiveOrderId(order.id);
                      setScreen('order');
                    }}
                  />
                  {i < arr.length - 1 && (
                    <div className="h-px bg-border-subtle ml-12" />
                  )}
                </motion.div>
              ))}
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-4 py-8 flex flex-col items-center justify-center text-center"
            >
              <p className="text-[13px] font-semibold text-text-secondary mb-1">No transactions yet</p>
              <p className="text-[11px] text-text-tertiary">Your trades will appear here</p>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* ── Bottom nav ── */}
      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} notificationCount={notificationCount} chatUnreadCount={unreadCount} />

      {/* ── UPI Pay (QR scan → amount → hand off to escrow flow) ── */}
      {showUpiPay && (
        <UpiPayScreen
          onClose={() => setShowUpiPay(false)}
          currentRate={currentRate}
          usdtBalance={IS_MOCK_MODE ? (userBalance ?? null) : solanaWallet.usdtBalance}
          onConfirm={(data) => {
            setShowUpiPay(false);
            onUpiPayConfirm?.(data);
          }}
        />
      )}

      {/* ── Deposit / Receive — Apple-style bottom sheet with QR ── */}
      <AnimatePresence>
        {showDeposit && (
          <>
            <motion.div
              key="deposit-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setShowDeposit(false)}
              className="fixed inset-0 z-50"
              style={{
                background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
              }}
            />
            <motion.div
              key="deposit-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="fixed left-0 right-0 bottom-0 z-50 px-3"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 12px) + 16px)' }}
            >
              <div
                className="max-w-[440px] mx-auto"
                style={{
                  padding: '18px 20px 22px',
                  borderRadius: 28,
                  background: 'rgba(20,24,32,0.92)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  backdropFilter: 'blur(28px) saturate(1.4)',
                  WebkitBackdropFilter: 'blur(28px) saturate(1.4)',
                  boxShadow: '0 -20px 50px -10px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
              >
                {/* Drag pip */}
                <div className="flex justify-center mb-3">
                  <span style={{ width: 36, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.18)' }} />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', color: 'rgba(255,255,255,0.96)' }}>
                      Receive USDT
                    </h2>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                      Solana network · SPL token
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDeposit(false)}
                    className="flex items-center justify-center"
                    style={{
                      width: 30, height: 30, borderRadius: 999,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <X size={14} strokeWidth={2.4} style={{ color: 'rgba(255,255,255,0.55)' }} />
                  </button>
                </div>

                {/* QR card */}
                <div
                  className="flex items-center justify-center mx-auto"
                  style={{
                    width: 232, height: 232,
                    padding: 14,
                    borderRadius: 24,
                    background: '#FFFFFF',
                    boxShadow: '0 16px 36px -12px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.85)',
                  }}
                >
                  {qrDataUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={qrDataUrl} alt="Wallet QR" style={{ width: '100%', height: '100%' }} />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full">
                      <Loader2 size={20} className="animate-spin" style={{ color: 'rgba(15,23,42,0.45)' }} />
                    </div>
                  )}
                </div>

                {/* Address pill + copy */}
                <div className="flex items-center mt-5" style={{ gap: 8 }}>
                  <div
                    className="flex-1 flex items-center"
                    style={{
                      padding: '11px 14px',
                      borderRadius: 14,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      gap: 10,
                      minWidth: 0,
                    }}
                  >
                    <span
                      className="truncate"
                      style={{
                        flex: 1,
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'rgba(255,255,255,0.78)',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      }}
                    >
                      {solanaWallet.walletAddress || '—'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      const addr = solanaWallet.walletAddress;
                      if (!addr) return;
                      try {
                        navigator.clipboard?.writeText(addr);
                      } catch {}
                      setDepositCopied(true);
                      setTimeout(() => setDepositCopied(false), 1800);
                    }}
                    className="flex items-center justify-center"
                    style={{
                      width: 44, height: 44, borderRadius: 14,
                      background: depositCopied ? 'rgba(16,185,129,0.18)' : '#FFFFFF',
                      border: depositCopied ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(255,255,255,0.6)',
                      boxShadow: depositCopied ? 'none' : '0 6px 14px -6px rgba(255,255,255,0.30), inset 0 1px 0 rgba(255,255,255,0.85)',
                      transition: 'background 200ms ease, border-color 200ms ease',
                    }}
                  >
                    {depositCopied
                      ? <Check size={16} strokeWidth={2.6} style={{ color: '#10B981' }} />
                      : <Copy size={15} strokeWidth={2.4} style={{ color: '#0B0F14' }} />}
                  </button>
                </div>

                {/* Warning */}
                <p
                  className="text-center"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.42)',
                    marginTop: 14,
                    lineHeight: 1.4,
                  }}
                >
                  Send only USDT (SPL) on Solana. Other tokens or networks will be lost.
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
