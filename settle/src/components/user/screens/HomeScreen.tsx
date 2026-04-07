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
import { colors, card as cardPreset, sectionLabel, mono } from "@/lib/design/theme";
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
      className="w-full flex items-center gap-4 text-left"
      style={{ padding: '14px 0' }}
    >
      {/* Avatar */}
      <div className="relative shrink-0"
        style={{
          width: 48, height: 48, borderRadius: 16, overflow: 'hidden',
          background: colors.bg.secondary,
          border: `1px solid ${colors.border.subtle}`,
          flexShrink: 0,
        }}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={order.merchant.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span style={{ fontSize: 18, fontWeight: 800, color: colors.text.primary }}>
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
              background: colors.success, border: `2px solid ${colors.bg.primary}`,
            }}
          />
        )}
      </div>

      {/* Name + date */}
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: 15, fontWeight: 700, color: colors.text.primary, letterSpacing: '-0.01em', marginBottom: 3 }}>
          {isBuy ? 'Buy USDT' : 'Sell USDT'}
        </p>
        <p style={{ fontSize: 12, fontWeight: 500, color: colors.text.tertiary }}>
          {order.merchant.name} · {formatDate(order.createdAt)}
        </p>
      </div>

      {/* Amount */}
      <div className="text-right shrink-0">
        <p style={{ fontSize: 15, fontWeight: 700, color: colors.text.primary, letterSpacing: '-0.015em', ...mono }}>
          {isBuy ? '-' : '+'}{'\u062F.\u0625'}{amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
        <p style={{ fontSize: 11, fontWeight: 500, color: colors.text.tertiary, marginTop: 2, ...mono }}>
          {parseFloat(order.cryptoAmount).toFixed(2)} USDT
        </p>
      </div>
    </motion.button>
  );
}

// ─── Wallet balance + chart + actions ───────────────────────────────────
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
          <p style={{ ...sectionLabel, margin: 0 }}>
            Total Balance
          </p>
          <div className="flex items-center gap-1.5">
            <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.8, repeat: Infinity }}
              style={{ width: 5, height: 5, borderRadius: '50%', background: colors.success }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: colors.text.tertiary, letterSpacing: '0.05em', ...mono }}>
              {currentRate} AED
            </span>
          </div>
        </div>

        {isWalletReady ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>

            {/* Balance number */}
            <div className="flex items-baseline gap-1" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 58, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1, color: colors.text.primary, ...mono }}>
                {balWhole}
              </span>
              <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: colors.text.quaternary, lineHeight: 1, ...mono }}>
                {balDec}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.text.quaternary, marginLeft: 4, letterSpacing: '0.04em' }}>
                USDT
              </span>
            </div>

            {/* Profit */}
            <div className="flex items-center gap-1.5" style={{ marginBottom: 12 }}>
              <TrendingUp size={11} style={{ color: colors.success }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: colors.success, letterSpacing: '0.01em', ...mono }}>+$557.00 today</span>
            </div>

            {/* Sparkline */}
            <div style={{ marginLeft: -4, marginRight: -4 }}>
              <div className="flex justify-between mb-1" style={{ paddingLeft: 4, paddingRight: 4 }}>
                <span style={{ fontSize: 8, fontWeight: 600, color: colors.text.quaternary, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  7D
                </span>
                <span style={{ fontSize: 8, fontWeight: 700, color: colors.success, letterSpacing: '0.06em', ...mono }}>
                  ↑ 3.6%
                </span>
              </div>
              <HomeSparkline height={72} />
              <div className="flex justify-between mt-1" style={{ paddingLeft: 4, paddingRight: 4 }}>
                <span style={{ fontSize: 8, color: colors.text.quaternary, fontWeight: 500 }}>Mar 13</span>
                <span style={{ fontSize: 8, color: colors.text.quaternary, fontWeight: 500 }}>Today</span>
              </div>
            </div>

          </motion.div>
        ) : (
          <div className="flex flex-col items-start gap-4">
            <p style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-0.04em', color: colors.text.quaternary, lineHeight: 1 }}>——</p>
            <p style={{ fontSize: 14, color: colors.text.secondary, lineHeight: 1.5 }}>
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
              style={{ background: colors.accent.primary, color: colors.accent.text, fontSize: 14, fontWeight: 700 }}>
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
          { label: 'Send',     Icon: ArrowUpRight,  primary: false,  fn: () => { setTradeType('sell'); setScreen('trade'); } },
          { label: 'Pay',      Icon: ArrowDownLeft, primary: false, fn: () => { setTradeType('buy');  setScreen('trade'); } },
          { label: 'Activity', Icon: Activity,      primary: false, fn: () => setScreen('orders') },
          { label: 'Deposit',  Icon: QrCode,        primary: false, fn: () => setScreen('chats') },
        ] as const).map(({ label, Icon, primary, fn }) => (
          <motion.button key={label} whileTap={{ scale: 0.91 }} onClick={fn}
            className="flex flex-col items-center gap-2 cursor-pointer">
            <div className="flex items-center justify-center"
              style={{
                width: 56, height: 56,
                borderRadius: 18,
                ...(primary
                  ? { background: colors.accent.primary, boxShadow: `0 4px 20px ${colors.accent.glow}` }
                  : { background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }),
              }}>
              <Icon size={22} strokeWidth={2}
                style={{ color: primary ? colors.white : colors.text.secondary }} />
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: primary ? colors.text.primary : colors.text.secondary }}>
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
  const displayBalance = IS_MOCK_MODE ? (userBalance ?? 0) : solanaWallet.usdtBalance;
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
    <div className="relative flex flex-col" style={{ minHeight: '100dvh', background: colors.bg.primary }}>

      {/* ══════════════════════════════════════════════
          HERO CARD — gradient dark surface
         ══════════════════════════════════════════════ */}
      <div className="relative shrink-0" style={{
        minHeight: cardH ? cardH : '50svh',
        paddingBottom: 12,
        borderRadius: '0 0 32px 32px',
        background: `linear-gradient(168deg, ${colors.bg.secondary} 0%, ${colors.bg.primary} 100%)`,
      }}>

        {/* ── Ambient decorations ── */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-b-[32px]">
          {/* Accent glow top-left */}
          <div style={{
            position: 'absolute', top: '-20%', left: '-15%',
            width: '65%', height: '65%',
            background: `radial-gradient(ellipse, ${colors.accent.glow} 0%, transparent 65%)`,
            filter: 'blur(60px)',
          }} />

          {/* Accent glow bottom-right */}
          <div style={{
            position: 'absolute', bottom: '-15%', right: '-10%',
            width: '60%', height: '60%',
            background: 'radial-gradient(ellipse, rgba(16,185,129,0.04) 0%, transparent 65%)',
            filter: 'blur(55px)',
          }} />

          {/* Shimmer */}
          <motion.div
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 6, repeat: Infinity, repeatDelay: 8, ease: 'easeInOut' }}
            style={{
              position: 'absolute', top: 0, bottom: 0,
              left: 0, width: '35%',
              background: 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.015) 50%, transparent 100%)',
              transform: 'skewX(-12deg)',
            }}
          />

          {/* Dot grid */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
          }} />

          {/* Bottom rule */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 1,
            background: `linear-gradient(90deg, transparent, ${colors.border.subtle} 30%, ${colors.border.subtle} 70%, transparent)`,
          }} />
        </div>

        {/* ── Header ── */}
        <div className={`${maxW} mx-auto relative z-10`} style={{ padding: '16px 24px 0' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>

            {/* Avatar + name + wallet */}
            <div className="flex items-center gap-3">
              <motion.button whileTap={{ scale: 0.92 }} onClick={() => setScreen('profile')}>
                <div className="relative w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: colors.accent.primary }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: colors.accent.text }}>
                    {userName.charAt(0).toUpperCase()}
                  </span>
                  {/* <ConnectionIndicator isConnected={!!userId} /> */}
                </div>
              </motion.button>
              <div className="flex flex-col gap-0.5">
                <span style={{ fontSize: 17, fontWeight: 700, color: colors.text.primary, letterSpacing: '-0.02em' }}>
                  {userName}
                </span>
                {solanaWallet.walletAddress && (
                  <div className="flex items-center gap-1.5">
                    <span style={{ fontSize: 10, color: colors.text.tertiary, letterSpacing: '0.04em', ...mono }}>
                      {solanaWallet.walletAddress.slice(0, 6)}…{solanaWallet.walletAddress.slice(-6)}
                    </span>
                    <motion.button whileTap={{ scale: 0.88 }} onClick={copyNavWallet}
                      className="flex items-center justify-center"
                      style={{
                        width: 18, height: 18, borderRadius: 5,
                        background: navCopied ? colors.successDim : colors.surface.card,
                        border: navCopied ? `1px solid ${colors.successBorder}` : `1px solid ${colors.border.subtle}`,
                      }}>
                      {navCopied
                        ? <Check size={9} style={{ color: colors.success }} />
                        : <Copy size={9} style={{ color: colors.text.tertiary }} />}
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
                background: colors.surface.card,
                border: `1px solid ${colors.border.subtle}`,
              }}>
              <Bell size={17} strokeWidth={1.8} style={{ color: colors.text.secondary }} />
              {unreadCount > 0 && (
                <div className="absolute flex items-center justify-center"
                  style={{
                    top: -3, right: -3,
                    width: 15, height: 15, borderRadius: '50%',
                    background: colors.accent.primary, border: `2px solid ${colors.bg.primary}`,
                  }}>
                  <span style={{ fontSize: 7, fontWeight: 800, color: colors.white }}>{unreadCount}</span>
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
          TRANSACTIONS SECTION
         ══════════════════════════════════════════════ */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.18, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 relative z-10"
        style={{
          background: colors.bg.primary,
          paddingBottom: 96,
        }}
      >
        <div className={`${maxW} mx-auto px-5 pt-4`}>

          <div className="mb-6">
            <div className="flex justify-between items-center mb-3">
              <p style={{ ...sectionLabel }}>Circle</p>
            </div>
            {orders.length === 0 ? (
              <p style={{ fontSize: 12, color: colors.text.tertiary, fontWeight: 600 }}>No trading partners yet</p>
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
                          background: 'transparent',
                          border: `1.5px solid ${colors.border.medium}`,
                        }}>
                          <div style={{
                            width: 52, height: 52, borderRadius: 19,
                            background: colors.bg.secondary,
                            border: `1px solid ${colors.border.subtle}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <span style={{ fontSize: 20, fontWeight: 800, color: colors.text.primary }}>{initial}</span>
                          </div>
                        </div>
                        {isActive && (
                          <motion.div animate={{ scale: [1, 1.35, 1] }} transition={{ duration: 2, repeat: Infinity }}
                            className="absolute flex items-center justify-center"
                            style={{
                              bottom: -3, right: -3, width: 14, height: 14, borderRadius: '50%',
                              background: colors.success, border: `2px solid ${colors.bg.primary}`,
                            }}>
                            <Zap size={6} className="fill-white text-white" />
                          </motion.div>
                        )}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: colors.text.tertiary }}>
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
            <h2 style={{ fontSize: 20, fontWeight: 800, color: colors.text.primary, letterSpacing: '-0.025em' }}>
              Transactions
            </h2>
            {orders.length > 0 && (
              <motion.button whileTap={{ scale: 0.94 }} onClick={() => setScreen('orders')}
                className="flex items-center gap-0.5"
                style={{ fontSize: 13, fontWeight: 600, color: colors.text.tertiary }}>
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
              style={{ padding: '13px 15px', background: colors.accent.subtle, border: `1px solid ${colors.accent.border}` }}
            >
              <motion.div animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
                style={{ width: 7, height: 7, borderRadius: '50%', background: colors.accent.primary, flexShrink: 0 }} />
              <div className="flex-1">
                <p style={{ fontSize: 14, fontWeight: 700, color: colors.text.primary, marginBottom: 2, letterSpacing: '-0.01em' }}>
                  {pendingOrders[0].type === 'buy' ? 'Buying' : 'Selling'} {parseFloat(pendingOrders[0].cryptoAmount).toFixed(2)} USDT
                </p>
                <p style={{ fontSize: 11, color: colors.text.tertiary, fontWeight: 500 }}>
                  {pendingOrders[0].status === 'pending' ? 'Finding merchant...' : `Step ${pendingOrders[0].step} of 4 · Tap to continue`}
                </p>
              </div>
              <ChevronRight size={17} strokeWidth={2} style={{ color: colors.text.tertiary, flexShrink: 0 }} />
            </motion.button>
          )}

          {/* Transaction rows */}
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
                      <div style={{ height: 1, background: colors.border.subtle, marginLeft: 64 }} />
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
                    <div style={{ flex: 1, height: 1, background: colors.border.subtle }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: colors.text.quaternary, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      Sample data
                    </span>
                    <div style={{ flex: 1, height: 1, background: colors.border.subtle }} />
                  </motion.div>
                )}
              </div>
            );
          })()}
        </div>
      </motion.div>

      {/* ── Bottom nav ── */}
      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </div>
  );
};
