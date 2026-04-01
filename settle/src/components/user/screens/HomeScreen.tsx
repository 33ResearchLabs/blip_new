"use client";

import { motion } from "framer-motion";
import {
  Bell,
  ArrowUpRight,
  ArrowDownLeft,
  Zap,
  QrCode,
  Activity,
  ChevronRight,
  Copy,
  Check,
  TrendingUp,
} from "lucide-react";
import { useState as useStateHook, useEffect } from "react";
import { ConnectionIndicator } from "@/components/NotificationToast";
import { HomeSparkline } from "./HomeDecorations";
import { BottomNav } from "./BottomNav";
import type { Screen, Order } from "./types";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';
const IS_MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

export interface HomeScreenProps {
  userName: string;
  userId: string | null;
  orders: Order[];
  completedOrders: Order[];
  pendingOrders: Order[];
  currentRate: number;
  screen: Screen;
  setScreen: (s: Screen) => void;
  setTradeType: (t: "buy" | "sell") => void;
  setActiveOrderId: (id: string) => void;
  setPendingTradeData: (data: { amount: string; fiatAmount: string; type: "buy" | "sell"; paymentMethod: "bank" | "cash" } | null) => void;
  setShowWalletModal: (v: boolean) => void;
  setShowWalletSetup: (v: boolean) => void;
  setShowWalletUnlock: (v: boolean) => void;
  solanaWallet: {
    connected: boolean;
    walletAddress: string | null;
    usdtBalance: number | null;
  };
  embeddedWallet?: {
    state: 'none' | 'locked' | 'unlocked';
  };
  userBalance?: number;
  maxW: string;
}

// ─── Avatar palettes — premium gradients, no neon ─────────────────────────
const AVATAR_PALETTES = [
  { bg: '#111111', letter: '#ffffff' },
  { bg: '#1a1a1a', letter: '#ffffff' },
  { bg: '#222222', letter: '#ffffff' },
  { bg: '#111111', letter: '#ffffff' },
  { bg: '#1a1a1a', letter: '#ffffff' },
];

function formatDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Single transaction row ────────────────────────────────────────────────
function TxRow({ order, index, onPress, avatarUrl }: { order: Order; index: number; onPress: () => void; avatarUrl?: string }) {
  const palette = AVATAR_PALETTES[index % AVATAR_PALETTES.length];
  const isBuy = order.type === 'buy';
  const amount = parseFloat(order.fiatAmount);
  const isActive = order.status !== 'complete';

  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onPress}
      className="w-full flex items-center gap-4 text-left"
      style={{ padding: '13px 0' }}
    >
      {/* Avatar — photo if available, else gradient initial */}
      <div className="relative shrink-0"
        style={{ width: 48, height: 48, borderRadius: 16, overflow: 'hidden', background: palette.bg, flexShrink: 0 }}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={order.merchant.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span style={{ fontSize: 18, fontWeight: 800, color: palette.letter }}>
              {order.merchant.name?.charAt(0)?.toUpperCase() ?? 'T'}
            </span>
          </div>
        )}
        {isActive && (
          <motion.div
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.4, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 10, height: 10, borderRadius: '50%',
              background: '#10b981', border: '2px solid #fff',
            }}
          />
        )}
      </div>

      {/* Name + date */}
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: 15, fontWeight: 700, color: '#0a0a0a', letterSpacing: '-0.01em', marginBottom: 3 }}>
          {isBuy ? 'Buy USDT' : 'Sell USDT'}
        </p>
        <p style={{ fontSize: 12, fontWeight: 500, color: '#a3a3a3' }}>
          {order.merchant.name} · {formatDate(order.createdAt)}
        </p>
      </div>

      {/* Amount */}
      <div className="text-right shrink-0">
        <p style={{ fontSize: 15, fontWeight: 700, color: '#0a0a0a', letterSpacing: '-0.015em' }}>
          {isBuy ? '-' : '+'}{'\u062F.\u0625'}{amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
        <p style={{ fontSize: 11, fontWeight: 500, color: '#a3a3a3', marginTop: 2 }}>
          {parseFloat(order.cryptoAmount).toFixed(2)} USDT
        </p>
      </div>
    </motion.button>
  );
}

// ─── Wallet balance + chart + actions — extracted so hooks work ───────────
function WalletBalanceSection({
  displayBalance, isWalletReady,
  solanaWallet, embeddedWallet, completedOrders, currentRate,
  setShowWalletModal, setShowWalletSetup, setShowWalletUnlock,
  setTradeType, setScreen,
}: {
  displayBalance: number | null;
  isWalletReady: boolean;
  solanaWallet: { connected: boolean; walletAddress: string | null; usdtBalance: number | null };
  embeddedWallet?: { state: 'none' | 'locked' | 'unlocked' };
  completedOrders: Order[];
  currentRate: number;
  setShowWalletModal: (v: boolean) => void;
  setShowWalletSetup: (v: boolean) => void;
  setShowWalletUnlock: (v: boolean) => void;
  setTradeType: (t: 'buy' | 'sell') => void;
  setScreen: (s: Screen) => void;
}) {
  const balance  = displayBalance ?? 0;
  const balWhole = Math.floor(balance).toLocaleString();
  const balDec   = (balance % 1).toFixed(2).slice(1);

  return (
    <>
      {/* ── Balance ── */}
      <div style={{ marginBottom: 8 }}>
        {/* Label row */}
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', margin: 0 }}>
            Total Balance
          </p>
          {/* Live dot */}
          <div className="flex items-center gap-1.5">
            <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.8, repeat: Infinity }}
              style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.05em' }}>
              {currentRate} AED
            </span>
          </div>
        </div>

        {isWalletReady ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>

            {/* Balance number */}
            <div className="flex items-baseline gap-1" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 58, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1, color: '#fff' }}>
                {balWhole}
              </span>
              <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'rgba(255,255,255,0.22)', lineHeight: 1 }}>
                {balDec}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.2)', marginLeft: 4, letterSpacing: '0.04em' }}>
                USDT
              </span>
            </div>

            {/* Profit — clean, no background */}
            <div className="flex items-center gap-1.5" style={{ marginBottom: 12 }}>
              <TrendingUp size={11} style={{ color: '#10b981' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#10b981', letterSpacing: '0.01em' }}>+$557.00 today</span>
            </div>

            {/* Sparkline with labels */}
            <div style={{ marginLeft: -4, marginRight: -4 }}>
              <div className="flex justify-between mb-1" style={{ paddingLeft: 4, paddingRight: 4 }}>
                <span style={{ fontSize: 8, fontWeight: 600, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  7D
                </span>
                <span style={{ fontSize: 8, fontWeight: 700, color: '#10b981', letterSpacing: '0.06em' }}>
                  ↑ 3.6%
                </span>
              </div>
              <HomeSparkline height={72} />
              <div className="flex justify-between mt-1" style={{ paddingLeft: 4, paddingRight: 4 }}>
                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', fontWeight: 500 }}>Mar 13</span>
                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', fontWeight: 500 }}>Today</span>
              </div>
            </div>

          </motion.div>
        ) : (
          <div className="flex flex-col items-start gap-4">
            <p style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-0.04em', color: 'rgba(255,255,255,0.15)', lineHeight: 1 }}>——</p>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
              {IS_EMBEDDED_WALLET
                ? embeddedWallet?.state === 'locked' ? 'Unlock your wallet' : 'Set up a wallet to start trading'
                : 'Connect your Solana wallet to trade'}
            </p>
            <motion.button whileTap={{ scale: 0.96 }}
              onClick={() => {
                if (IS_EMBEDDED_WALLET) {
                  if (embeddedWallet?.state === 'locked') setShowWalletUnlock(true);
                  else setShowWalletSetup(true);
                } else { setShowWalletModal(true); }
              }}
              className="px-6 py-3 rounded-2xl"
              style={{ background: '#fff', color: '#000', fontSize: 14, fontWeight: 700 }}>
              {IS_EMBEDDED_WALLET
                ? embeddedWallet?.state === 'locked' ? 'Unlock Wallet' : 'Create Wallet'
                : 'Connect Wallet'}
            </motion.button>
          </div>
        )}
      </div>

      {/* ── Action buttons ── */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }}
        className="flex justify-around"
        style={{ marginTop: 28 }}
      >
        {([
          { label: 'Send',     Icon: ArrowUpRight,  primary: true,  fn: () => { setTradeType('sell'); setScreen('trade'); } },
          { label: 'Pay',      Icon: ArrowDownLeft, primary: false, fn: () => { setTradeType('buy');  setScreen('trade'); } },
          { label: 'Activity', Icon: Activity,      primary: false, fn: () => setScreen('orders') },
          { label: 'Deposit',  Icon: QrCode,        primary: false, fn: () => setScreen('chats') },
        ] as const).map(({ label, Icon, primary, fn }) => (
          <motion.button key={label} whileTap={{ scale: 0.91 }} onClick={fn}
            className="flex flex-col items-center gap-2">
            <div className="flex items-center justify-center"
              style={{
                width: 56, height: 56,
                borderRadius: 18,
                ...(primary
                  ? { background: '#ffffff' }
                  : { background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.07)' }),
              }}>
              <Icon size={22} strokeWidth={2}
                style={{ color: primary ? '#000' : 'rgba(255,255,255,0.5)' }} />
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: primary ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.5)' }}>
              {label}
            </span>
          </motion.button>
        ))}
      </motion.div>
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
}: HomeScreenProps) => {
  // In mock mode, use DB balance; otherwise use on-chain balance
  const displayBalance = IS_MOCK_MODE ? (userBalance ?? 0) : solanaWallet.usdtBalance;
  // In mock mode, consider "connected" if user is logged in (userId exists)
  const isWalletReady = IS_MOCK_MODE ? (userBalance !== undefined && userBalance !== null) : solanaWallet.connected;

  const unreadCount = orders.reduce((s, o) => s + (o.unreadCount || 0), 0);
  const [navCopied, setNavCopied] = useStateHook(false);
  const [cardH, setCardH] = useStateHook<number | null>(null);
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
    <div className="relative flex flex-col" style={{ minHeight: '100dvh', background: '#ffffff' }}>

      {/* ══════════════════════════════════════════════
          BLACK CARD — rounds at the bottom, sits on white
         ══════════════════════════════════════════════ */}
      <div className="relative shrink-0" style={{
        minHeight: cardH ? cardH : '50svh',
        paddingBottom: 12,
        borderRadius: '0 0 40px 40px',
        background: `#000000`,
      }}>

        {/* ── Card-illusion layered gradients ── */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-b-[40px]">

          {/* Diagonal card sheen */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.028) 0%, transparent 45%, rgba(255,255,255,0.012) 100%)',
          }} />

          {/* Top-left corner bloom */}
          <div style={{
            position: 'absolute', top: '-20%', left: '-15%',
            width: '65%', height: '65%',
            background: 'radial-gradient(ellipse, rgba(255,255,255,0.06) 0%, transparent 65%)',
            filter: 'blur(60px)',
          }} />

          {/* Bottom-right bloom */}
          <div style={{
            position: 'absolute', bottom: '-15%', right: '-10%',
            width: '60%', height: '60%',
            background: 'radial-gradient(ellipse, rgba(255,255,255,0.04) 0%, transparent 65%)',
            filter: 'blur(55px)',
          }} />

          {/* Animated center shimmer */}
          <motion.div
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 6, repeat: Infinity, repeatDelay: 8, ease: 'easeInOut' }}
            style={{
              position: 'absolute', top: 0, bottom: 0,
              left: 0, width: '35%',
              background: 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.018) 50%, transparent 100%)',
              transform: 'skewX(-12deg)',
            }}
          />

          {/* Dot grid */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
          }} />

          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }} />

          {/* Horizontal rule near the bottom */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06) 30%, rgba(255,255,255,0.06) 70%, transparent)',
          }} />
        </div>

        {/* ── Header — floats on black ── */}
        <div className={`${maxW} mx-auto relative z-10`} style={{ padding: '16px 24px 0' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>

            {/* Avatar + name + wallet */}
            <div className="flex items-center gap-3">
              <motion.button whileTap={{ scale: 0.92 }} onClick={() => setScreen('profile')}>
                <div className="relative w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: '#ffffff' }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#000' }}>
                    {userName.charAt(0).toUpperCase()}
                  </span>
                  <ConnectionIndicator isConnected={!!userId} />
                </div>
              </motion.button>
              <div className="flex flex-col gap-0.5">
                <span style={{ fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
                  {userName}
                </span>
                {solanaWallet.walletAddress && (
                  <div className="flex items-center gap-1.5">
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.04em' }}>
                      {solanaWallet.walletAddress.slice(0, 6)}…{solanaWallet.walletAddress.slice(-6)}
                    </span>
                    <motion.button whileTap={{ scale: 0.88 }} onClick={copyNavWallet}
                      className="flex items-center justify-center"
                      style={{
                        width: 18, height: 18, borderRadius: 5,
                        background: navCopied ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.07)',
                        border: navCopied ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.1)',
                      }}>
                      {navCopied
                        ? <Check size={9} style={{ color: '#10b981' }} />
                        : <Copy size={9} style={{ color: 'rgba(255,255,255,0.4)' }} />}
                    </motion.button>
                  </div>
                )}
              </div>
            </div>

            {/* Bell */}
            <motion.button whileTap={{ scale: 0.88 }} onClick={() => setScreen('chats')}
              className="relative flex items-center justify-center"
              style={{
                width: 38, height: 38, borderRadius: 13,
                background: 'rgba(255,255,255,0.055)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}>
              <Bell size={17} strokeWidth={1.8} style={{ color: 'rgba(255,255,255,0.65)' }} />
              {unreadCount > 0 && (
                <div className="absolute flex items-center justify-center"
                  style={{
                    top: -3, right: -3,
                    width: 15, height: 15, borderRadius: '50%',
                    background: '#fff', border: '2px solid #000',
                  }}>
                  <span style={{ fontSize: 7, fontWeight: 800, color: '#000' }}>{unreadCount}</span>
                </div>
              )}
            </motion.button>
          </div>

          {/* ── Balance section ── */}
          <div style={{ marginTop: 32 }} />
          <WalletBalanceSection
            displayBalance={displayBalance}
            isWalletReady={isWalletReady}
            solanaWallet={solanaWallet}
            embeddedWallet={embeddedWallet}
            completedOrders={completedOrders}
            currentRate={currentRate}
            setShowWalletModal={setShowWalletModal}
            setShowWalletSetup={setShowWalletSetup}
            setShowWalletUnlock={setShowWalletUnlock}
            setTradeType={setTradeType}
            setScreen={setScreen}
          />
        </div>
      </div>


      {/* ══════════════════════════════════════════════
          WHITE CARD — elevated from below
         ══════════════════════════════════════════════ */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.18, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 relative z-10"
        style={{
          background: '#ffffff',
          borderRadius: 0,
          paddingBottom: 96,
        }}
      >
        <div className={`${maxW} mx-auto px-5 pt-4`}>

          <div className="mb-6">
            <div className="flex justify-between items-center mb-3">
              <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: '#a3a3a3', textTransform: 'uppercase' }}>Circle</p>
            </div>
            {orders.length === 0 ? (
              <p style={{ fontSize: 12, color: '#a3a3a3', fontWeight: 600 }}>No trading partners yet</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto no-scrollbar" style={{ marginLeft: -4, paddingLeft: 4, paddingRight: 4 }}>
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
                        <div style={{
                          padding: 2, borderRadius: 22,
                          background: isActive ? '#000' : 'transparent',
                          border: isActive ? 'none' : '1.5px solid #e5e5e5',
                        }}>
                          <div style={{ width: 52, height: 52, borderRadius: 19, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{initial}</span>
                          </div>
                        </div>
                        {isActive && (
                          <motion.div animate={{ scale: [1, 1.35, 1] }} transition={{ duration: 2, repeat: Infinity }}
                            className="absolute flex items-center justify-center"
                            style={{ bottom: -3, right: -3, width: 14, height: 14, borderRadius: '50%', background: '#000', border: '2px solid #fff' }}>
                            <Zap size={6} className="fill-white text-white" />
                          </motion.div>
                        )}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#737373' }}>
                        {order.merchant.name?.split(' ')?.[0] ?? 'Trader'}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section title */}
          <div className="flex items-center justify-between mb-1">
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0a0a0a', letterSpacing: '-0.025em' }}>
              Transactions
            </h2>
            {orders.length > 0 && (
              <motion.button whileTap={{ scale: 0.94 }} onClick={() => setScreen('orders')}
                className="flex items-center gap-0.5"
                style={{ fontSize: 13, fontWeight: 600, color: '#a3a3a3' }}>
                See all <ChevronRight size={14} strokeWidth={2} style={{ marginTop: 1 }} />
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
              className="w-full flex items-center gap-3 text-left rounded-[18px] mt-3 mb-1"
              style={{ padding: '13px 15px', background: '#0a0a0a' }}
            >
              <motion.div animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
                style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', flexShrink: 0 }} />
              <div className="flex-1">
                <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 2, letterSpacing: '-0.01em' }}>
                  {pendingOrders[0].type === 'buy' ? 'Buying' : 'Selling'} {parseFloat(pendingOrders[0].cryptoAmount).toFixed(2)} USDT
                </p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
                  {pendingOrders[0].status === 'pending' ? 'Finding merchant...' : `Step ${pendingOrders[0].step} of 4 · Tap to continue`}
                </p>
              </div>
              <ChevronRight size={17} strokeWidth={2} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
            </motion.button>
          )}

          {/* Transaction rows — show dummy if no real orders */}
          {(() => {
            const DUMMY: {
              id: string; type: 'buy' | 'sell'; cryptoAmount: string; fiatAmount: string;
              cryptoCode: string; fiatCode: string;
              merchant: { id: string; name: string; rating: number; trades: number; rate: number; paymentMethod: 'bank' | 'cash' };
              status: 'complete'; step: 4; createdAt: Date; expiresAt: Date;
              avatar: string;
            }[] = [
              { id: 'd1', type: 'buy',  cryptoAmount: '120',  fiatAmount: '440.64',  cryptoCode: 'USDC', fiatCode: 'KES', merchant: { id: 'm1', name: 'AlphaTrader',  rating: 4.9, trades: 312, rate: 3.672, paymentMethod: 'bank' }, status: 'complete', step: 4, createdAt: new Date('2024-03-18'), expiresAt: new Date(), avatar: 'https://i.pravatar.cc/150?img=11' },
              { id: 'd2', type: 'sell', cryptoAmount: '85',   fiatAmount: '312.12',  cryptoCode: 'USDC', fiatCode: 'KES', merchant: { id: 'm2', name: 'FastMerchant', rating: 4.7, trades: 198, rate: 3.672, paymentMethod: 'bank' }, status: 'complete', step: 4, createdAt: new Date('2024-03-16'), expiresAt: new Date(), avatar: 'https://i.pravatar.cc/150?img=32' },
              { id: 'd3', type: 'buy',  cryptoAmount: '200',  fiatAmount: '734.40',  cryptoCode: 'USDC', fiatCode: 'KES', merchant: { id: 'm3', name: 'VaultFX',      rating: 5.0, trades: 540, rate: 3.672, paymentMethod: 'bank' }, status: 'complete', step: 4, createdAt: new Date('2024-03-14'), expiresAt: new Date(), avatar: 'https://i.pravatar.cc/150?img=47' },
              { id: 'd4', type: 'sell', cryptoAmount: '50',   fiatAmount: '183.60',  cryptoCode: 'USDC', fiatCode: 'KES', merchant: { id: 'm4', name: 'SwiftPay',     rating: 4.8, trades: 87,  rate: 3.672, paymentMethod: 'cash' }, status: 'complete', step: 4, createdAt: new Date('2024-03-11'), expiresAt: new Date(), avatar: 'https://i.pravatar.cc/150?img=23' },
              { id: 'd5', type: 'buy',  cryptoAmount: '300',  fiatAmount: '1101.60', cryptoCode: 'USDC', fiatCode: 'KES', merchant: { id: 'm5', name: 'NovaTrade',    rating: 4.6, trades: 231, rate: 3.672, paymentMethod: 'bank' }, status: 'complete', step: 4, createdAt: new Date('2024-03-09'), expiresAt: new Date(), avatar: 'https://i.pravatar.cc/150?img=58' },
            ];

            const rows = orders.length > 0
              ? orders.slice(0, 8)
              : (DUMMY as typeof orders);

            return (
              <div className="mt-2">
                {rows.map((order, i) => (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.07, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <TxRow
                      order={order}
                      index={i}
                      avatarUrl={orders.length === 0 ? (DUMMY[i] as typeof DUMMY[0])?.avatar : undefined}
                      onPress={() => {
                        if (orders.length > 0) {
                          setActiveOrderId(order.id);
                          setScreen('order');
                        } else {
                          setScreen('trade');
                        }
                      }}
                    />
                    {i < rows.length - 1 && (
                      <div style={{ height: 1, background: '#f5f5f5', marginLeft: 64 }} />
                    )}
                  </motion.div>
                ))}

                {orders.length === 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.55 }}
                    className="flex items-center justify-center gap-2 mt-4 mb-2"
                  >
                    <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#c0c0c0', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      Sample data
                    </span>
                    <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
                  </motion.div>
                )}
              </div>
            );
          })()}
        </div>
      </motion.div>

      {/* ── Bottom nav — sits on the white card ── */}
      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </div>
  );
};
