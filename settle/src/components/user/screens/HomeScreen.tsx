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

const SECTION_LABEL = "text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase";

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
      className="w-full flex items-center gap-4 text-left py-[14px]"
    >
      {/* Avatar */}
      <div className="relative shrink-0 w-12 h-12 rounded-[16px] overflow-hidden bg-surface-raised border border-border-subtle">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={order.merchant.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[18px] font-extrabold text-text-primary">
              {order.merchant.name?.charAt(0)?.toUpperCase() ?? 'T'}
            </span>
          </div>
        )}
        {isActive && (
          <motion.div
            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.4, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success border-2 border-surface-base"
          />
        )}
      </div>

      {/* Name + date */}
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-bold text-text-primary tracking-[-0.01em] mb-[3px]">
          {isBuy ? 'Buy USDT' : 'Sell USDT'}
        </p>
        <p className="text-[12px] font-medium text-text-tertiary">
          {order.merchant.name} · {formatDate(order.createdAt)}
        </p>
      </div>

      {/* Amount */}
      <div className="text-right shrink-0">
        <p className="text-[15px] font-bold text-text-primary tracking-[-0.015em] font-mono">
          {isBuy ? '-' : '+'}{'\u062F.\u0625'}{amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
        <p className="text-[11px] font-medium text-text-tertiary mt-0.5 font-mono">
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
      <div className="mb-2">
        {/* Label row */}
        <div className="flex items-center justify-between mb-2">
          <p className={SECTION_LABEL}>Total Balance</p>
          <div className="flex items-center gap-1.5">
            <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.8, repeat: Infinity }}
              className="w-[5px] h-[5px] rounded-full bg-success" />
            <span className="text-[10px] font-semibold text-text-tertiary tracking-[0.05em] font-mono">
              {currentRate} AED
            </span>
          </div>
        </div>

        {isWalletReady ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>

            {/* Balance number */}
            <div className="flex items-baseline gap-1 mb-1.5">
              <span className="text-[58px] font-extrabold tracking-[-0.045em] leading-none text-text-primary font-mono">
                {balWhole}
              </span>
              <span className="text-[28px] font-bold tracking-[-0.02em] text-text-quaternary leading-none font-mono">
                {balDec}
              </span>
              <span className="text-[13px] font-semibold text-text-quaternary ml-1 tracking-[0.04em]">
                USDT
              </span>
            </div>

            {/* Profit */}
            <div className="flex items-center gap-1.5 mb-3">
              <TrendingUp size={11} className="text-success" />
              <span className="text-[12px] font-bold text-success tracking-[0.01em] font-mono">+$557.00 today</span>
            </div>

            {/* Sparkline */}
            <div className="-mx-1">
              <div className="flex justify-between mb-1 px-1">
                <span className="text-[8px] font-semibold text-text-quaternary tracking-[0.1em] uppercase">
                  7D
                </span>
                <span className="text-[8px] font-bold text-success tracking-[0.06em] font-mono">
                  ↑ 3.6%
                </span>
              </div>
              <HomeSparkline height={72} />
              <div className="flex justify-between mt-1 px-1">
                <span className="text-[8px] text-text-quaternary font-medium">Mar 13</span>
                <span className="text-[8px] text-text-quaternary font-medium">Today</span>
              </div>
            </div>

          </motion.div>
        ) : (
          <div className="flex flex-col items-start gap-4">
            <p className="text-[52px] font-extrabold tracking-[-0.04em] text-text-quaternary leading-none">——</p>
            <p className="text-[14px] text-text-secondary leading-[1.5]">
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
              className="px-6 py-3 rounded-2xl bg-accent text-accent-text text-[14px] font-bold">
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
        className="flex justify-around mt-7"
      >
        {([
          { label: 'Send',     Icon: ArrowUpRight,  primary: false,  fn: () => { setTradeType('sell'); setScreen('trade'); } },
          { label: 'Pay',      Icon: ArrowDownLeft, primary: false, fn: () => { setTradeType('buy');  setScreen('trade'); } },
          { label: 'Activity', Icon: Activity,      primary: false, fn: () => setScreen('orders') },
          { label: 'Deposit',  Icon: QrCode,        primary: false, fn: () => setScreen('chats') },
        ] as const).map(({ label, Icon, primary, fn }) => (
          <motion.button key={label} whileTap={{ scale: 0.91 }} onClick={fn}
            className="flex flex-col items-center gap-2 cursor-pointer">
            <div className={`flex items-center justify-center w-14 h-14 rounded-[18px] ${
              primary
                ? 'bg-accent shadow-[0_4px_20px_rgba(255,255,255,0.08)]'
                : 'bg-surface-card border border-border-subtle'
            }`}>
              <Icon size={22} strokeWidth={2}
                className={primary ? 'text-white' : 'text-text-secondary'} />
            </div>
            <span className={`text-[9px] font-bold uppercase tracking-[0.12em] ${
              primary ? 'text-text-primary' : 'text-text-secondary'
            }`}>
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
    <div className="relative flex flex-col min-h-[100dvh] bg-surface-base">

      {/* ══════════════════════════════════════════════
          HERO CARD — gradient dark surface
         ══════════════════════════════════════════════ */}
      <div
        className="relative shrink-0 pb-3 rounded-b-[32px] bg-gradient-to-b from-surface-raised to-surface-base"
        style={{ minHeight: cardH ? `${cardH}px` : '50svh' }}
      >

        {/* ── Ambient decorations ── */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-b-[32px]">
          {/* Accent glow top-left */}
          <div
            className="absolute -top-[20%] -left-[15%] w-[65%] h-[65%] blur-[60px]"
            style={{ background: 'radial-gradient(ellipse, rgba(255,255,255,0.08) 0%, transparent 65%)' }}
          />

          {/* Accent glow bottom-right */}
          <div
            className="absolute -bottom-[15%] -right-[10%] w-[60%] h-[60%] blur-[55px]"
            style={{ background: 'radial-gradient(ellipse, rgba(16,185,129,0.04) 0%, transparent 65%)' }}
          />

          {/* Shimmer */}
          <motion.div
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 6, repeat: Infinity, repeatDelay: 8, ease: 'easeInOut' }}
            className="absolute top-0 bottom-0 left-0 w-[35%] -skew-x-12"
            style={{ background: 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.015) 50%, transparent 100%)' }}
          />

          {/* Dot grid */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px)',
              backgroundSize: '26px 26px',
            }}
          />

          {/* Bottom rule */}
          <div
            className="absolute bottom-0 left-0 right-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06) 30%, rgba(255,255,255,0.06) 70%, transparent)' }}
          />
        </div>

        {/* ── Header ── */}
        <div className={`${maxW} mx-auto relative z-10 px-6 pt-4`}>
          <div className="flex items-center justify-between mb-4">

            {/* Avatar + name + wallet */}
            <div className="flex items-center gap-3">
              <motion.button whileTap={{ scale: 0.92 }} onClick={() => setScreen('profile')}>
                <div className="relative w-10 h-10 rounded-full flex items-center justify-center bg-accent">
                  <span className="text-[15px] font-extrabold text-accent-text">
                    {userName.charAt(0).toUpperCase()}
                  </span>
                  {/* <ConnectionIndicator isConnected={!!userId} /> */}
                </div>
              </motion.button>
              <div className="flex flex-col gap-0.5">
                <span className="text-[17px] font-bold text-text-primary tracking-[-0.02em]">
                  {userName}
                </span>
                {solanaWallet.walletAddress && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-tertiary tracking-[0.04em] font-mono">
                      {solanaWallet.walletAddress.slice(0, 6)}…{solanaWallet.walletAddress.slice(-6)}
                    </span>
                    <motion.button whileTap={{ scale: 0.88 }} onClick={copyNavWallet}
                      className={`flex items-center justify-center w-[18px] h-[18px] rounded-[5px] ${
                        navCopied
                          ? 'bg-success-dim border border-success-border'
                          : 'bg-surface-card border border-border-subtle'
                      }`}>
                      {navCopied
                        ? <Check size={9} className="text-success" />
                        : <Copy size={9} className="text-text-tertiary" />}
                    </motion.button>
                  </div>
                )}
              </div>
            </div>

            {/* Bell */}
            <motion.button whileTap={{ scale: 0.88 }} onClick={() => setScreen('chats')}
              className="relative flex items-center justify-center w-[38px] h-[38px] rounded-[13px] bg-surface-card border border-border-subtle">
              <Bell size={17} strokeWidth={1.8} className="text-text-secondary" />
              {unreadCount > 0 && (
                <div className="absolute -top-[3px] -right-[3px] flex items-center justify-center w-[15px] h-[15px] rounded-full bg-accent border-2 border-surface-base">
                  <span className="text-[7px] font-extrabold text-white">{unreadCount}</span>
                </div>
              )}
            </motion.button>
          </div>

          {/* ── Balance section ── */}
          <div className="mt-8" />
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
        className="flex-1 relative z-10 bg-surface-base pb-24"
      >
        <div className={`${maxW} mx-auto px-5 pt-4`}>

          <div className="mb-6">
            <div className="flex justify-between items-center mb-3">
              <p className={SECTION_LABEL}>Circle</p>
            </div>
            {orders.length === 0 ? (
              <p className="text-[12px] text-text-tertiary font-semibold">No trading partners yet</p>
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
                        <div className="p-0.5 rounded-[22px] bg-transparent border-[1.5px] border-border-medium">
                          <div className="w-[52px] h-[52px] rounded-[19px] bg-surface-raised border border-border-subtle flex items-center justify-center">
                            <span className="text-[20px] font-extrabold text-text-primary">{initial}</span>
                          </div>
                        </div>
                        {isActive && (
                          <motion.div animate={{ scale: [1, 1.35, 1] }} transition={{ duration: 2, repeat: Infinity }}
                            className="absolute -bottom-[3px] -right-[3px] flex items-center justify-center w-[14px] h-[14px] rounded-full bg-success border-2 border-surface-base">
                            <Zap size={6} className="fill-white text-white" />
                          </motion.div>
                        )}
                      </div>
                      <span className="text-[10px] font-semibold text-text-tertiary">
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
            <h2 className="text-[20px] font-extrabold text-text-primary tracking-[-0.025em]">
              Transactions
            </h2>
            {orders.length > 0 && (
              <motion.button whileTap={{ scale: 0.94 }} onClick={() => setScreen('orders')}
                className="flex items-center gap-0.5 text-[13px] font-semibold text-text-tertiary">
                See all <ChevronRight size={14} strokeWidth={2} className="mt-px" />
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
              className="w-full flex items-center gap-3 text-left rounded-[18px] mt-3 mb-1 py-[13px] px-[15px] bg-white/[0.06] border border-white/15"
            >
              <motion.div animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
                className="w-[7px] h-[7px] rounded-full bg-white shrink-0" />
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
                      <div className="h-px bg-border-subtle ml-16" />
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
                    <div className="flex-1 h-px bg-border-subtle" />
                    <span className="text-[10px] font-semibold text-text-quaternary tracking-[0.1em] uppercase">
                      Sample data
                    </span>
                    <div className="flex-1 h-px bg-border-subtle" />
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
