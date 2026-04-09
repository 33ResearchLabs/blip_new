"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Copy,
  Plus,
  Wallet,
  Sun,
  Moon,
  X,
  TrendingUp,
  ChevronRight,
  LogOut,
  Shield,
  FileText,
  Download,
  Eye,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  Landmark,
  Settings,
  AlertTriangle,
} from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { BottomNav } from "./BottomNav";
import { mapDbOrderToUI } from "./helpers";
import type { Screen, Order, BankAccount, DbOrder } from "./types";
import type { MutableRefObject } from "react";
import type { ReputationScore, ReputationTier } from "@/lib/reputation/types";
import { TIER_INFO } from "@/lib/reputation/types";

// ── Period filter options ──
type PeriodFilter = '1m' | '3m' | '6m' | '1y';
const PERIOD_OPTIONS: { key: PeriodFilter; label: string; shortLabel: string; days: number }[] = [
  { key: '1m', label: '1 Month', shortLabel: '1M', days: 30 },
  { key: '3m', label: '3 Months', shortLabel: '3M', days: 90 },
  { key: '6m', label: '6 Months', shortLabel: '6M', days: 180 },
  { key: '1y', label: '1 Year', shortLabel: '1Y', days: 365 },
];

// ── Status colors ──
function getTradeStatusStyle(status: string) {
  switch (status) {
    case 'complete': return 'bg-success-dim text-success border-success-border';
    case 'cancelled':
    case 'expired': return 'bg-error-dim text-error border-error-border';
    case 'disputed': return 'bg-warning-dim text-warning border-warning-border';
    default: return 'bg-surface-active text-text-secondary border-border-medium';
  }
}

// ── Statement CSV generator ──
function generateStatementCSV(trades: Order[], summary: { totalCredits: number; totalDebits: number; previousBalance: number; closingBalance: number }, periodLabel: string): string {
  const lines: string[] = [];
  lines.push(`Trade Statement - ${periodLabel}`);
  lines.push(`Generated: ${new Date().toLocaleDateString('en-GB')}`);
  lines.push('');
  lines.push('Summary');
  lines.push(`Previous Balance,${summary.previousBalance.toFixed(2)} USDT`);
  lines.push(`Total Credits (Buys),${summary.totalCredits.toFixed(2)} USDT`);
  lines.push(`Total Debits (Sells),${summary.totalDebits.toFixed(2)} USDT`);
  lines.push(`Closing Balance,${summary.closingBalance.toFixed(2)} USDT`);
  lines.push('');
  lines.push('Date,Type,Status,Crypto Amount,Crypto,Fiat Amount,Fiat,Merchant,Rate');
  for (const t of trades) {
    const date = new Date(t.createdAt).toLocaleDateString('en-GB');
    lines.push(`${date},${t.type.toUpperCase()},${t.status},${t.cryptoAmount},${t.cryptoCode},${t.fiatAmount},${t.fiatCode},${t.merchant.name},${t.merchant.rate}`);
  }
  return lines.join('\n');
}

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

// ── Design tokens ──
const CARD = "bg-surface-card border border-border-subtle rounded-[16px]";
const LABEL = "text-[10px] font-bold tracking-[0.2em] text-text-tertiary uppercase";

export interface ProfileScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  userId: string | null;
  userName: string;
  completedOrders: Order[];
  timedOutOrders: Order[];
  solanaWallet: {
    connected: boolean;
    walletAddress: string | null;
    solBalance: number | null;
    usdtBalance: number | null;
    refreshBalances: () => Promise<void>;
    disconnect: () => void;
  };
  setShowWalletModal: (v: boolean) => void;
  embeddedWallet?: {
    state: 'none' | 'locked' | 'unlocked';
    unlockWallet: (password: string) => Promise<boolean>;
    lockWallet: () => void;
    deleteWallet: () => void;
    setKeypairAndUnlock: (kp: any) => void;
  };
  setShowWalletSetup?: (v: boolean) => void;
  setShowWalletUnlock?: (v: boolean) => void;
  copied: boolean;
  setCopied: (v: boolean) => void;
  bankAccounts: BankAccount[];
  showAddBank: boolean;
  setShowAddBank: (v: boolean) => void;
  newBank: { bank: string; iban: string; name: string };
  setNewBank: React.Dispatch<React.SetStateAction<{ bank: string; iban: string; name: string }>>;
  addBankAccount: () => void;
  resolvedDisputes: Array<{
    id: string;
    orderNumber: string;
    resolvedInFavorOf: string;
    resolvedAt: string;
    otherPartyName: string;
    cryptoAmount: number;
    reason: string;
  }>;
  theme: string;
  toggleTheme: () => void;
  isAuthenticatingRef: MutableRefObject<boolean>;
  lastAuthenticatedWalletRef: MutableRefObject<string | null>;
  authAttemptedForWalletRef: MutableRefObject<string | null>;
  setShowUsernameModal: (v: boolean) => void;
  setUserId: (v: string | null) => void;
  setUserWallet: (v: string | null) => void;
  setUserName: (v: string) => void;
  setUserBalance: (v: number) => void;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setBankAccounts: React.Dispatch<React.SetStateAction<BankAccount[]>>;
  setResolvedDisputes: React.Dispatch<React.SetStateAction<any[]>>;
  setLoginError: (v: string) => void;
  setLoginForm: (v: { username: string; password: string }) => void;
  maxW: string;
}

export const ProfileScreen = ({
  screen,
  setScreen,
  userId,
  userName,
  completedOrders,
  timedOutOrders,
  solanaWallet,
  setShowWalletModal,
  embeddedWallet,
  setShowWalletSetup,
  setShowWalletUnlock,
  copied,
  setCopied,
  bankAccounts,
  showAddBank,
  setShowAddBank,
  newBank,
  setNewBank,
  addBankAccount,
  resolvedDisputes,
  theme,
  toggleTheme,
  isAuthenticatingRef,
  lastAuthenticatedWalletRef,
  authAttemptedForWalletRef,
  setShowUsernameModal,
  setUserId,
  setUserWallet,
  setUserName,
  setUserBalance,
  setOrders,
  setBankAccounts,
  setResolvedDisputes,
  setLoginError,
  setLoginForm,
  maxW,
}: ProfileScreenProps) => {
  // ── Reputation ──
  const [reputation, setReputation] = useState<ReputationScore | null>(null);
  const [reputationLoading, setReputationLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setReputationLoading(true);
    fetch(`/api/reputation?entityId=${userId}&entityType=user`)
      .then(r => r.json())
      .then(res => {
        if (!cancelled && res.success && res.data?.score) {
          setReputation(res.data.score);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReputationLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  // ── Trade History ──
  const [tradePeriod, setTradePeriod] = useState<PeriodFilter>('1m');
  const [allTrades, setAllTrades] = useState<Order[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [showStatement, setShowStatement] = useState(false);

  const fetchTrades = useCallback(async (period: PeriodFilter) => {
    if (!userId) return;
    setTradesLoading(true);
    try {
      const days = PERIOD_OPTIONS.find(p => p.key === period)!.days;
      const res = await fetchWithAuth(`/api/orders?user_id=${userId}&days=${days}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        const mapped = data.data
          .map((o: DbOrder) => mapDbOrderToUI(o))
          .filter((o: Order | null): o is Order => o !== null);
        setAllTrades(mapped);
      }
    } catch {
      // silent
    } finally {
      setTradesLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchTrades(tradePeriod);
  }, [tradePeriod, fetchTrades]);

  const tradeSummary = useMemo(() => {
    const credits = allTrades
      .filter(t => t.type === 'buy' && t.status === 'complete')
      .reduce((s, t) => s + parseFloat(t.cryptoAmount), 0);
    const debits = allTrades
      .filter(t => t.type === 'sell' && t.status === 'complete')
      .reduce((s, t) => s + parseFloat(t.cryptoAmount), 0);
    return {
      totalTrades: allTrades.length,
      completedTrades: allTrades.filter(t => t.status === 'complete').length,
      cancelledTrades: allTrades.filter(t => t.status === 'cancelled' || t.status === 'expired').length,
      disputedTrades: allTrades.filter(t => t.status === 'disputed').length,
      totalCredits: credits,
      totalDebits: debits,
      previousBalance: 0,
      closingBalance: credits - debits,
    };
  }, [allTrades]);

  const handleDownloadStatement = useCallback(() => {
    const periodLabel = PERIOD_OPTIONS.find(p => p.key === tradePeriod)!.label;
    const csv = generateStatementCSV(allTrades, tradeSummary, periodLabel);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blip-statement-${tradePeriod}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [allTrades, tradeSummary, tradePeriod]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('blip_user');
    localStorage.removeItem('blip_wallet');
    isAuthenticatingRef.current = false;
    lastAuthenticatedWalletRef.current = null;
    authAttemptedForWalletRef.current = null;
    setShowUsernameModal(false);
    setShowWalletModal(false);
    setUserId(null);
    setUserWallet(null);
    setUserName('Guest');
    setUserBalance(0);
    setOrders([]);
    setBankAccounts([]);
    setResolvedDisputes([]);
    setLoginError('');
    setLoginForm({ username: '', password: '' });
    if (solanaWallet.disconnect) solanaWallet.disconnect();
    window.location.href = '/';
  }, [isAuthenticatingRef, lastAuthenticatedWalletRef, authAttemptedForWalletRef, setShowUsernameModal, setShowWalletModal, setUserId, setUserWallet, setUserName, setUserBalance, setOrders, setBankAccounts, setResolvedDisputes, setLoginError, setLoginForm, solanaWallet]);

  // ── Derived ──
  const tierInfo = reputation ? TIER_INFO[reputation.tier] : null;
  const scorePercent = reputation ? (reputation.total_score / 1000) * 100 : 0;
  const totalVolume = completedOrders.reduce((s, o) => s + parseFloat(o.cryptoAmount), 0);
  const successRate = completedOrders.length > 0
    ? (completedOrders.length / (completedOrders.length + timedOutOrders.length) * 100)
    : 0;

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">
      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">

        {/* ═══════════════════════════════════════════
            HERO: Avatar + Name + Reputation + Stats
        ═══════════════════════════════════════════ */}
        <div className="px-5 pt-12 pb-5">
          {/* Avatar row */}
          <div className="flex items-center gap-4 mb-5">
            <div className="relative">
              <div className="w-16 h-16 rounded-[22px] flex items-center justify-center bg-accent/10 border-2 border-accent/30">
                <span className="text-[28px] font-black text-accent">{userName.charAt(0).toUpperCase()}</span>
              </div>
              {tierInfo && (
                <div
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center border-2 border-surface-base"
                  style={{ backgroundColor: tierInfo.color }}
                >
                  <Shield size={11} className="text-white" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[22px] font-black tracking-[-0.03em] text-text-primary leading-tight">{userName}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {tierInfo && (
                  <span className="text-[11px] font-bold" style={{ color: tierInfo.color }}>{tierInfo.name}</span>
                )}
                {reputation && (
                  <span className="text-[11px] font-semibold text-text-quaternary">{Math.round(reputation.total_score)} pts</span>
                )}
              </div>
              {solanaWallet.connected && solanaWallet.walletAddress ? (
                <button
                  onClick={async () => {
                    await copyToClipboard(solanaWallet.walletAddress!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="flex items-center gap-1 mt-1"
                >
                  <p className="text-[11px] font-semibold text-text-tertiary font-mono">
                    {solanaWallet.walletAddress.slice(0, 6)}...{solanaWallet.walletAddress.slice(-4)}
                  </p>
                  {copied
                    ? <Check size={10} className="text-success" />
                    : <Copy size={10} className="text-text-quaternary" />}
                </button>
              ) : (
                <p className="text-[11px] font-semibold text-text-quaternary mt-1">Wallet not connected</p>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Trades', value: completedOrders.length.toString(), sub: 'completed' },
              { label: 'Volume', value: totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : totalVolume.toFixed(0), sub: 'USDT' },
              { label: 'Success', value: successRate > 0 ? `${successRate.toFixed(0)}%` : '\u2014', sub: 'rate' },
            ].map(stat => (
              <div key={stat.label} className={`${CARD} flex flex-col items-center py-3`}>
                <p className="text-[18px] font-black tracking-[-0.03em] text-text-primary leading-tight">{stat.value}</p>
                <p className="text-[9px] font-bold tracking-[0.15em] text-text-quaternary uppercase mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            REPUTATION (expanded)
        ═══════════════════════════════════════════ */}
        {reputation && (
          <div className="px-5 mb-4">
            <div className={`${CARD} p-4`}>
              {/* Score bar */}
              <div className="flex items-center justify-between mb-2">
                <p className={LABEL}>Reputation Score</p>
                <p className="text-[12px] font-bold text-text-secondary">{Math.round(reputation.total_score)}<span className="text-text-quaternary">/1000</span></p>
              </div>
              <div className="w-full h-2 rounded-full bg-surface-hover overflow-hidden mb-3">
                <motion.div
                  className="h-full rounded-full bg-accent"
                  initial={{ width: 0 }}
                  animate={{ width: `${scorePercent}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>

              {/* Component breakdown */}
              <div className="grid grid-cols-5 gap-2">
                {[
                  { label: 'Reviews', value: reputation.review_score },
                  { label: 'Execution', value: reputation.execution_score },
                  { label: 'Volume', value: reputation.volume_score },
                  { label: 'Activity', value: reputation.consistency_score },
                  { label: 'Trust', value: reputation.trust_score },
                ].map(c => (
                  <div key={c.label} className="flex flex-col items-center gap-1">
                    <div className="relative w-9 h-9">
                      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                        <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" className="stroke-surface-hover" />
                        <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" strokeDasharray={`${c.value * 0.94} 100`} strokeLinecap="round" className="stroke-accent" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-text-secondary">{Math.round(c.value)}</span>
                    </div>
                    <p className="text-[8px] font-bold text-text-quaternary tracking-[0.05em] uppercase">{c.label}</p>
                  </div>
                ))}
              </div>

              {/* Badges */}
              {reputation.badges.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border-subtle">
                  {reputation.badges.map(badge => (
                    <span key={badge} className="text-[9px] font-bold tracking-[0.05em] uppercase px-2 py-1 rounded-full bg-accent/10 text-accent">
                      {badge.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Fallback reputation for users without API score */}
        {!reputation && !reputationLoading && completedOrders.length > 0 && (
          <div className="px-5 mb-4">
            <div className={`${CARD} px-4 py-3 flex items-center justify-between`}>
              <div>
                <p className={`${LABEL} mb-0.5`}>Reputation</p>
                <p className="text-[15px] font-extrabold text-text-primary">
                  {completedOrders.length >= 50 ? 'Elite Trader' : completedOrders.length >= 20 ? 'Trusted' : completedOrders.length >= 10 ? 'Established' : completedOrders.length >= 3 ? 'Emerging' : 'New Trader'}
                </p>
              </div>
              <div className="flex items-end gap-0.5">
                {[8, 12, 16, 20, 24].map((h, i) => {
                  const lvl = completedOrders.length >= 50 ? 5 : completedOrders.length >= 20 ? 4 : completedOrders.length >= 10 ? 3 : completedOrders.length >= 3 ? 2 : 1;
                  return <div key={i} style={{ height: h }} className={`w-1 rounded-[2px] ${i < lvl ? 'bg-accent' : 'bg-text-quaternary'}`} />;
                })}
              </div>
            </div>
          </div>
        )}

        <div className="px-5 space-y-4 pb-28">

          {/* ═══════════════════════════════════════════
              ASSETS: Wallet + Bank Accounts
          ═══════════════════════════════════════════ */}
          <section>
            <p className={`${LABEL} mb-2`}>Assets</p>
            <div className={`${CARD} overflow-hidden`}>
              {/* Wallet row */}
              <button
                onClick={() => {
                  if (solanaWallet.connected) return;
                  if (IS_EMBEDDED_WALLET && setShowWalletSetup && setShowWalletUnlock) {
                    if (embeddedWallet?.state === 'locked') setShowWalletUnlock(true);
                    else setShowWalletSetup(true);
                  } else {
                    setShowWalletModal(true);
                  }
                }}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-hover/50 transition-colors"
              >
                <div className={`w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 ${
                  solanaWallet.connected ? 'bg-accent/10' : 'bg-surface-hover'
                }`}>
                  <Wallet size={16} className={solanaWallet.connected ? 'text-accent' : 'text-text-tertiary'} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[13px] font-bold text-text-primary">Solana Wallet</p>
                  <p className="text-[11px] text-text-tertiary">
                    {solanaWallet.connected ? 'Connected' : 'Tap to connect'}
                  </p>
                </div>
                {solanaWallet.connected && (
                  <div className="flex gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-[12px] font-bold text-text-primary">{solanaWallet.solBalance?.toFixed(4) ?? '\u2014'}</p>
                      <p className="text-[9px] font-bold text-text-quaternary">SOL</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[12px] font-bold text-text-primary">{solanaWallet.usdtBalance?.toFixed(2) ?? '\u2014'}</p>
                      <p className="text-[9px] font-bold text-text-quaternary">USDT</p>
                    </div>
                  </div>
                )}
                {!solanaWallet.connected && <ChevronRight size={14} className="text-text-quaternary shrink-0" />}
              </button>

              {/* Wallet actions */}
              {solanaWallet.connected && (
                <div className="flex gap-2 px-4 pb-3">
                  <motion.button whileTap={{ scale: 0.96 }} onClick={() => solanaWallet.refreshBalances()}
                    className="flex-1 py-1.5 rounded-[10px] bg-surface-hover text-[10px] font-bold text-text-secondary tracking-[0.08em] uppercase">
                    Refresh
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.96 }} onClick={() => solanaWallet.disconnect()}
                    className="flex-1 py-1.5 rounded-[10px] bg-error-dim text-[10px] font-bold text-error tracking-[0.08em] uppercase">
                    Disconnect
                  </motion.button>
                </div>
              )}

              {/* Divider */}
              <div className="h-px bg-border-subtle mx-4" />

              {/* Bank accounts header */}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-[12px] flex items-center justify-center bg-surface-hover shrink-0">
                    <Landmark size={16} className="text-text-tertiary" />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-text-primary">Bank Accounts</p>
                    <p className="text-[11px] text-text-tertiary">{bankAccounts.length} account{bankAccounts.length !== 1 ? 's' : ''} linked</p>
                  </div>
                </div>
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowAddBank(true)}
                  className="w-7 h-7 rounded-[8px] flex items-center justify-center bg-accent/10">
                  <Plus size={14} className="text-accent" />
                </motion.button>
              </div>

              {/* Bank list */}
              {bankAccounts.map((acc, idx) => (
                <div key={acc.id} className={`flex items-center gap-3 px-4 py-2.5 ${idx < bankAccounts.length - 1 ? '' : 'pb-3'}`}>
                  <div className="w-6 h-6 rounded-[6px] flex items-center justify-center bg-surface-active text-[12px] shrink-0 ml-12">
                    {'\uD83C\uDFE6'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[12px] font-semibold text-text-primary">{acc.bank}</p>
                      {acc.isDefault && (
                        <span className="text-[7px] font-bold tracking-[0.1em] uppercase px-1 py-[1px] rounded bg-accent text-accent-text">Default</span>
                      )}
                    </div>
                    <p className="text-[10px] text-text-quaternary font-mono">{acc.iban}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ═══════════════════════════════════════════
              TRADE HISTORY
          ═══════════════════════════════════════════ */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className={LABEL}>Trade History</p>
              <div className="flex gap-1">
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowStatement(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-[8px] bg-surface-hover text-[9px] font-bold text-text-tertiary tracking-[0.05em] uppercase">
                  <Eye size={10} /> Statement
                </motion.button>
                <motion.button whileTap={{ scale: 0.9 }} onClick={handleDownloadStatement}
                  className="flex items-center gap-1 px-2 py-1 rounded-[8px] bg-accent/10 text-[9px] font-bold text-accent tracking-[0.05em] uppercase">
                  <Download size={10} /> CSV
                </motion.button>
              </div>
            </div>

            {/* Period pills */}
            <div className="flex gap-1 mb-3">
              {PERIOD_OPTIONS.map(opt => (
                <motion.button
                  key={opt.key}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setTradePeriod(opt.key)}
                  className={`flex-1 py-2 rounded-[10px] text-[11px] font-bold tracking-[0.05em] transition-all ${
                    tradePeriod === opt.key
                      ? 'bg-accent text-accent-text shadow-sm'
                      : 'bg-surface-card text-text-tertiary border border-border-subtle'
                  }`}
                >
                  {opt.shortLabel}
                </motion.button>
              ))}
            </div>

            {/* Summary bar */}
            <div className={`${CARD} p-3 mb-3`}>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {[
                  { label: 'Prev. Bal', value: tradeSummary.previousBalance.toFixed(2) },
                  { label: 'Credits', value: `+${tradeSummary.totalCredits.toFixed(2)}`, color: 'text-success' },
                  { label: 'Debits', value: `-${tradeSummary.totalDebits.toFixed(2)}`, color: 'text-error' },
                  { label: 'Closing', value: tradeSummary.closingBalance.toFixed(2), bold: true },
                ].map(item => (
                  <div key={item.label} className="text-center">
                    <p className={`text-[13px] font-extrabold tracking-[-0.02em] ${item.color || 'text-text-primary'}`}>{item.value}</p>
                    <p className="text-[7px] font-bold tracking-[0.15em] text-text-quaternary uppercase">{item.label}</p>
                  </div>
                ))}
              </div>
              <div className="h-px bg-border-subtle mb-2" />
              <div className="flex justify-around">
                {[
                  { label: 'All', value: tradeSummary.totalTrades },
                  { label: 'Done', value: tradeSummary.completedTrades, color: 'text-success' },
                  { label: 'Failed', value: tradeSummary.cancelledTrades, color: 'text-error' },
                  { label: 'Dispute', value: tradeSummary.disputedTrades, color: 'text-warning' },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <p className={`text-[13px] font-bold ${s.color || 'text-text-primary'}`}>{s.value}</p>
                    <p className="text-[7px] font-bold tracking-[0.1em] text-text-quaternary uppercase">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Trade list */}
            {tradesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={18} className="animate-spin text-text-quaternary" />
              </div>
            ) : allTrades.length === 0 ? (
              <div className={`${CARD} px-4 py-8 text-center`}>
                <p className="text-[12px] font-semibold text-text-quaternary">No trades in this period</p>
              </div>
            ) : (
              <div className={`${CARD} overflow-hidden divide-y divide-border-subtle`}>
                {allTrades.map(trade => (
                  <div key={trade.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${
                      trade.type === 'buy' ? 'bg-success/10' : 'bg-error/10'
                    }`}>
                      {trade.type === 'buy'
                        ? <ArrowDownLeft size={14} className="text-success" />
                        : <ArrowUpRight size={14} className="text-error" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[12px] font-bold text-text-primary">
                          {trade.type === 'buy' ? 'Buy' : 'Sell'} {trade.cryptoCode}
                        </p>
                        <span className={`text-[7px] font-bold tracking-[0.08em] uppercase px-1.5 py-[2px] rounded-full border ${getTradeStatusStyle(trade.status)}`}>
                          {trade.status}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-quaternary mt-0.5">
                        {trade.merchant.name} &middot; {new Date(trade.createdAt).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-[13px] font-extrabold tracking-[-0.02em] ${
                        trade.type === 'buy' ? 'text-success' : 'text-error'
                      }`}>
                        {trade.type === 'buy' ? '+' : '-'}{trade.cryptoAmount}
                      </p>
                      <p className="text-[9px] font-semibold text-text-quaternary">{trade.fiatAmount} {trade.fiatCode}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ═══════════════════════════════════════════
              SETTINGS & MORE
          ═══════════════════════════════════════════ */}
          <section>
            <p className={`${LABEL} mb-2`}>Settings</p>
            <div className={`${CARD} overflow-hidden divide-y divide-border-subtle`}>
              {/* Analytics / Console */}
              <a href="/console" className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-hover/50 transition-colors">
                <div className="w-9 h-9 rounded-[12px] flex items-center justify-center bg-surface-hover shrink-0">
                  <TrendingUp size={16} className="text-text-tertiary" />
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-bold text-text-primary">Analytics & Console</p>
                  <p className="text-[10px] text-text-quaternary">Timeouts, performance insights</p>
                </div>
                {timedOutOrders.length > 0 && (
                  <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-error-dim text-error border border-error-border">
                    {timedOutOrders.length}
                  </span>
                )}
                <ChevronRight size={14} className="text-text-quaternary shrink-0" />
              </a>

              {/* Resolved Disputes (if any) */}
              {resolvedDisputes.length > 0 && (
                <div className="px-4 py-3.5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-[12px] flex items-center justify-center bg-warning/10 shrink-0">
                      <AlertTriangle size={16} className="text-warning" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[13px] font-bold text-text-primary">Resolved Disputes</p>
                      <p className="text-[10px] text-text-quaternary">{resolvedDisputes.length} dispute{resolvedDisputes.length !== 1 ? 's' : ''} resolved</p>
                    </div>
                  </div>
                  <div className="space-y-1.5 ml-12">
                    {resolvedDisputes.map(dispute => {
                      const won = dispute.resolvedInFavorOf === 'user';
                      const lost = dispute.resolvedInFavorOf === 'merchant';
                      return (
                        <div key={dispute.id} className="flex items-center justify-between py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-text-primary">#{dispute.orderNumber}</span>
                            <span className={`text-[7px] font-bold tracking-[0.1em] uppercase px-1.5 py-[2px] rounded-full ${
                              won ? 'bg-success-dim text-success' : lost ? 'bg-error-dim text-error' : 'bg-surface-active text-text-tertiary'
                            }`}>
                              {won ? 'Won' : lost ? 'Lost' : 'Split'}
                            </span>
                          </div>
                          <p className="text-[11px] font-bold text-text-primary">${dispute.cryptoAmount.toLocaleString()}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Theme */}
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-9 h-9 rounded-[12px] flex items-center justify-center bg-surface-hover shrink-0">
                  {theme === 'dark' ? <Moon size={16} className="text-text-tertiary" /> : <Sun size={16} className="text-text-tertiary" />}
                </div>
                <p className="flex-1 text-[13px] font-bold text-text-primary">
                  {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                </p>
                <button onClick={toggleTheme} className="shrink-0">
                  <div className={`w-11 h-6 rounded-full p-0.5 flex items-center transition-colors ${theme === 'dark' ? 'bg-accent' : 'bg-text-quaternary/30'}`}>
                    <div className={`w-5 h-5 rounded-full shadow-sm transition-transform ${
                      theme === 'dark' ? 'translate-x-5 bg-surface-base' : 'translate-x-0 bg-white'
                    }`} />
                  </div>
                </button>
              </div>

              {/* Sign Out */}
              <motion.button whileTap={{ scale: 0.98 }} onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-error-dim/30 transition-colors">
                <div className="w-9 h-9 rounded-[12px] flex items-center justify-center bg-error-dim shrink-0">
                  <LogOut size={16} className="text-error" />
                </div>
                <p className="text-[13px] font-bold text-error">Sign Out</p>
              </motion.button>
            </div>
          </section>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          MODALS
      ═══════════════════════════════════════════ */}

      {/* Statement Modal */}
      <AnimatePresence>
        {showStatement && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setShowStatement(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className={`fixed inset-0 z-50 m-auto w-[calc(100%-40px)] ${maxW} max-h-[80vh] flex flex-col bg-surface-base border border-border-medium rounded-[20px] shadow-2xl`}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-text-secondary" />
                  <p className="text-[15px] font-extrabold text-text-primary tracking-[-0.02em]">
                    Statement &mdash; {PERIOD_OPTIONS.find(p => p.key === tradePeriod)!.label}
                  </p>
                </div>
                <div className="flex gap-2">
                  <motion.button whileTap={{ scale: 0.9 }} onClick={handleDownloadStatement}
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-accent">
                    <Download size={14} className="text-accent-text" />
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowStatement(false)}
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-surface-hover">
                    <X size={14} className="text-text-tertiary" />
                  </motion.button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="rounded-[12px] p-3 bg-surface-hover border border-border-medium mb-4">
                  <p className={`${LABEL} mb-2`}>Account Summary</p>
                  {[
                    { label: 'Previous Balance', value: `${tradeSummary.previousBalance.toFixed(2)} USDT` },
                    { label: 'Total Credits (Buys)', value: `+${tradeSummary.totalCredits.toFixed(2)} USDT`, color: 'text-success' },
                    { label: 'Total Debits (Sells)', value: `-${tradeSummary.totalDebits.toFixed(2)} USDT`, color: 'text-error' },
                    { label: 'Closing Balance', value: `${tradeSummary.closingBalance.toFixed(2)} USDT`, bold: true },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-border-subtle last:border-0">
                      <p className="text-[12px] font-semibold text-text-tertiary">{row.label}</p>
                      <p className={`text-[12px] font-bold ${row.color || 'text-text-primary'} ${row.bold ? 'text-[13px] font-extrabold' : ''}`}>
                        {row.value}
                      </p>
                    </div>
                  ))}
                </div>

                <p className={`${LABEL} mb-2`}>Transactions ({allTrades.length})</p>
                <div className="divide-y divide-border-subtle">
                  {allTrades.map(trade => (
                    <div key={trade.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="text-[12px] font-bold text-text-primary">
                          {trade.type === 'buy' ? 'Buy' : 'Sell'} {trade.cryptoCode}
                        </p>
                        <p className="text-[10px] text-text-tertiary">
                          {new Date(trade.createdAt).toLocaleDateString('en-GB')} &middot; {trade.merchant.name}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-[12px] font-bold ${trade.type === 'buy' ? 'text-success' : 'text-error'}`}>
                          {trade.type === 'buy' ? '+' : '-'}{trade.cryptoAmount} {trade.cryptoCode}
                        </p>
                        <p className="text-[10px] text-text-quaternary">{trade.fiatAmount} {trade.fiatCode}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add Bank Modal */}
      <AnimatePresence>
        {showAddBank && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setShowAddBank(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-0 z-50 flex items-center justify-center px-5 py-8"
              onClick={() => setShowAddBank(false)}
            >
              <div
                className={`w-full ${maxW} rounded-[20px] shadow-2xl bg-surface-base border border-border-medium`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
                  <p className="text-[15px] font-extrabold text-text-primary tracking-[-0.02em]">Add Bank Account</p>
                  <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowAddBank(false)}
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-surface-hover">
                    <X size={14} className="text-text-tertiary" />
                  </motion.button>
                </div>
                <div className="px-5 py-4 flex flex-col gap-3">
                  {[
                    { label: 'Bank Name', field: 'bank' as const, placeholder: 'Emirates NBD' },
                    { label: 'IBAN', field: 'iban' as const, placeholder: 'AE12 0345 0000 0012 3456 789' },
                    { label: 'Account Name', field: 'name' as const, placeholder: 'John Doe' },
                  ].map(input => (
                    <div key={input.field}>
                      <p className={`${LABEL} block mb-1.5`}>{input.label}</p>
                      <input
                        value={newBank[input.field]}
                        onChange={(e) => setNewBank(p => ({ ...p, [input.field]: e.target.value }))}
                        placeholder={input.placeholder}
                        className="w-full bg-surface-hover border border-border-medium rounded-[12px] px-3.5 py-2.5 text-[13px] font-semibold text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent transition-colors"
                      />
                    </div>
                  ))}
                </div>
                <div className="px-5 pb-5 pt-1">
                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={addBankAccount}
                    disabled={!newBank.bank || !newBank.iban || !newBank.name}
                    className={`w-full h-11 rounded-[12px] text-[13px] font-extrabold tracking-[-0.01em] transition-colors ${
                      newBank.bank && newBank.iban && newBank.name
                        ? 'bg-accent text-accent-text'
                        : 'bg-surface-hover text-text-quaternary'
                    }`}>
                    Add Account
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </div>
  );
};
