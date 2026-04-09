"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Copy,
  User,
  Plus,
  Wallet,
  Sun,
  Moon,
  X,
  TrendingUp,
  ChevronRight,
  LogOut,
  Currency,
  Shield,
  FileText,
  Download,
  Eye,
  ArrowUpRight,
  ArrowDownLeft,
  Filter,
  Loader2,
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
const PERIOD_OPTIONS: { key: PeriodFilter; label: string; days: number }[] = [
  { key: '1m', label: '1 Month', days: 30 },
  { key: '3m', label: '3 Months', days: 90 },
  { key: '6m', label: '6 Months', days: 180 },
  { key: '1y', label: '1 Year', days: 365 },
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

// Class-string aliases — mirror the Card / SectionLabel / CardLabel components
// for places where we compose with extra utility classes inline.
const CARD = "bg-surface-card border border-border-subtle";
const SECTION_LABEL = "text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase";
const CARD_LABEL = SECTION_LABEL;

// Reputation bar heights (index → tailwind h-*)
const REP_BAR_H = ["h-2", "h-3", "h-4", "h-5", "h-6"]; // 8,12,16,20,24px

export interface ProfileScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  userId: string | null;
  userName: string;
  completedOrders: Order[];
  timedOutOrders: Order[];
  // Solana wallet
  solanaWallet: {
    connected: boolean;
    walletAddress: string | null;
    solBalance: number | null;
    usdtBalance: number | null;
    refreshBalances: () => Promise<void>;
    disconnect: () => void;
  };
  setShowWalletModal: (v: boolean) => void;
  // Embedded wallet
  embeddedWallet?: {
    state: 'none' | 'locked' | 'unlocked';
    unlockWallet: (password: string) => Promise<boolean>;
    lockWallet: () => void;
    deleteWallet: () => void;
    setKeypairAndUnlock: (kp: any) => void;
  };
  setShowWalletSetup?: (v: boolean) => void;
  setShowWalletUnlock?: (v: boolean) => void;
  // Copy
  copied: boolean;
  setCopied: (v: boolean) => void;
  // Banks
  bankAccounts: BankAccount[];
  showAddBank: boolean;
  setShowAddBank: (v: boolean) => void;
  newBank: { bank: string; iban: string; name: string };
  setNewBank: React.Dispatch<React.SetStateAction<{ bank: string; iban: string; name: string }>>;
  addBankAccount: () => void;
  // Disputes
  resolvedDisputes: Array<{
    id: string;
    orderNumber: string;
    resolvedInFavorOf: string;
    resolvedAt: string;
    otherPartyName: string;
    cryptoAmount: number;
    reason: string;
  }>;
  // Theme
  theme: string;
  toggleTheme: () => void;
  // Logout refs/state
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

  // ── Trade History State ──
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

  // ── Trade Summary ──
  const tradeSummary = useMemo(() => {
    const credits = allTrades
      .filter(t => t.type === 'buy' && t.status === 'complete')
      .reduce((s, t) => s + parseFloat(t.cryptoAmount), 0);
    const debits = allTrades
      .filter(t => t.type === 'sell' && t.status === 'complete')
      .reduce((s, t) => s + parseFloat(t.cryptoAmount), 0);
    const closingBalance = credits - debits;
    return {
      totalTrades: allTrades.length,
      completedTrades: allTrades.filter(t => t.status === 'complete').length,
      cancelledTrades: allTrades.filter(t => t.status === 'cancelled' || t.status === 'expired').length,
      disputedTrades: allTrades.filter(t => t.status === 'disputed').length,
      totalCredits: credits,
      totalDebits: debits,
      previousBalance: 0,
      closingBalance,
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

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-4 shrink-0">
        <p className={`${SECTION_LABEL} mb-1`}>Account</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-[16px] flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle">
              <span className="text-[20px] font-extrabold text-text-primary">{userName.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <p className="text-[20px] font-extrabold tracking-[-0.03em] text-text-primary leading-[1.1]">{userName}</p>
              <p className="text-[11px] font-semibold text-text-tertiary font-mono mt-0.5">
                {solanaWallet.connected && solanaWallet.walletAddress
                  ? `${solanaWallet.walletAddress.slice(0, 6)}...${solanaWallet.walletAddress.slice(-4)}`
                  : 'Wallet not connected'}
              </p>
            </div>
          </div>
          {solanaWallet.connected && solanaWallet.walletAddress && (
            <motion.button whileTap={{ scale: 0.85 }}
              onClick={async () => {
                await copyToClipboard(solanaWallet.walletAddress!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="w-9 h-9 rounded-[12px] flex items-center justify-center bg-surface-raised border border-border-subtle">
              {copied
                ? <Check size={15} className="text-success" />
                : <Copy size={15} className="text-text-tertiary" />}
            </motion.button>
          )}
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <div className="flex-1 px-5 pb-24 overflow-y-auto scrollbar-hide">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { label: 'Trades', value: completedOrders.length.toString() },
            { label: 'Volume', value: completedOrders.reduce((s, o) => s + parseFloat(o.cryptoAmount), 0).toFixed(0) , currency:'USDT'  } ,
            { label: 'Score', value: completedOrders.length > 0 ? (completedOrders.length / (completedOrders.length + timedOutOrders.length) * 100).toFixed(0) + '%' : '\u2014' },
          ].map(stat => (
            <div key={stat.label} className={`rounded-[18px] flex flex-col items-center py-3 ${CARD}`}>
              <p className={`${CARD_LABEL} mb-1`}>{stat.label}</p>
              <p className="text-[20px] font-extrabold tracking-[-0.03em] text-text-primary">{stat.value}{" "}<span className="text-sm">{stat.currency}</span></p>
            </div>
          ))}
        </div>

        {/* Reputation Score */}
        {reputation ? (() => {
          const tierInfo = TIER_INFO[reputation.tier];
          const tierOrder: ReputationTier[] = ['newcomer', 'bronze', 'silver', 'gold', 'platinum', 'diamond'];
          const tierIdx = tierOrder.indexOf(reputation.tier === 'risky' ? 'newcomer' : reputation.tier);
          const filledBars = Math.max(1, tierIdx + 1);
          return (
            <div className={`rounded-[18px] px-4 py-3 mb-3 ${CARD}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Shield size={16} style={{ color: tierInfo.color }} />
                  <div>
                    <p className={`${CARD_LABEL} mb-0.5`}>Reputation</p>
                    <p className="text-[16px] font-extrabold tracking-[-0.02em] text-text-primary">
                      {tierInfo.name}
                      <span className="text-[12px] font-bold text-text-tertiary ml-2">{Math.round(reputation.total_score)}/1000</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-end gap-1">
                  {tierOrder.map((_, i) => (
                    <div
                      key={i}
                      className={`w-1 rounded-[2px] ${REP_BAR_H[i]} ${i < filledBars ? 'bg-accent' : 'bg-text-quaternary'}`}
                    />
                  ))}
                </div>
              </div>
              {/* Component breakdown */}
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { label: 'Reviews', value: reputation.review_score },
                  { label: 'Execution', value: reputation.execution_score },
                  { label: 'Volume', value: reputation.volume_score },
                  { label: 'Activity', value: reputation.consistency_score },
                  { label: 'Trust', value: reputation.trust_score },
                ].map(c => (
                  <div key={c.label} className="flex flex-col items-center">
                    <div className="w-full h-1 rounded-full bg-surface-hover overflow-hidden">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${c.value}%` }} />
                    </div>
                    <p className="text-[8px] font-bold text-text-quaternary mt-0.5">{c.label}</p>
                  </div>
                ))}
              </div>
              {/* Badges */}
              {reputation.badges.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {reputation.badges.map(badge => (
                    <span key={badge} className="text-[9px] font-bold tracking-[0.05em] uppercase px-1.5 py-0.5 rounded-full bg-surface-active text-text-secondary">
                      {badge.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })() : completedOrders.length > 0 && !reputationLoading && (() => {
          const tier = completedOrders.length >= 50 ? 'Elite Trader' : completedOrders.length >= 20 ? 'Trusted' : completedOrders.length >= 10 ? 'Established' : completedOrders.length >= 3 ? 'Emerging' : 'New Trader';
          const lvl = completedOrders.length >= 50 ? 5 : completedOrders.length >= 20 ? 4 : completedOrders.length >= 10 ? 3 : completedOrders.length >= 3 ? 2 : 1;
          return (
            <div className={`rounded-[18px] px-4 py-3 flex items-center justify-between mb-3 ${CARD}`}>
              <div>
                <p className={`${CARD_LABEL} mb-1`}>Reputation</p>
                <p className="text-[16px] font-extrabold tracking-[-0.02em] text-text-primary">{tier}</p>
              </div>
              <div className="flex items-end gap-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-[2px] ${REP_BAR_H[i]} ${i < lvl ? 'bg-accent' : 'bg-text-quaternary'}`}
                  />
                ))}
              </div>
            </div>
          );
        })()}

        {/* Wallet */}
        <p className={`${SECTION_LABEL} block mb-2`}>Solana Wallet</p>
        <div className={`rounded-[18px] p-4 mb-3 ${CARD}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 border border-border-medium ${
              solanaWallet.connected ? 'bg-surface-active' : 'bg-surface-hover'
            }`}>
              <Wallet size={16} className={solanaWallet.connected ? 'text-text-primary' : 'text-text-tertiary'} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`${CARD_LABEL} mb-0.5`}>
                {solanaWallet.connected ? 'Solana Devnet' : 'Not Connected'}
              </p>
              <p className="text-[13px] font-bold text-text-primary font-mono">
                {solanaWallet.connected && solanaWallet.walletAddress
                  ? `${solanaWallet.walletAddress.slice(0, 6)}...${solanaWallet.walletAddress.slice(-4)}`
                  : 'Connect your wallet'}
              </p>
            </div>
          </div>

          {/* Solana Balances */}
          {solanaWallet.connected && (
            <>
              <div className="flex gap-2 mb-2 pt-3 border-t border-border-medium">
                {[
                  { label: 'SOL', value: solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : '\u2014' },
                  { label: 'USDT', value: solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '\u2014' },
                ].map(b => (
                  <div key={b.label} className="flex-1 rounded-[14px] px-3 py-2 bg-surface-hover border border-border-medium">
                    <p className={`${CARD_LABEL} mb-[3px]`}>{b.label}</p>
                    <p className="text-[17px] font-extrabold tracking-[-0.02em] text-text-primary">{b.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => solanaWallet.refreshBalances()}
                  className="flex-1 py-2 rounded-[12px] bg-surface-active text-[11px] font-bold text-text-secondary tracking-[0.08em] uppercase">
                  Refresh
                </motion.button>
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => solanaWallet.disconnect()}
                  className="flex-1 py-2 rounded-[12px] bg-error-dim border border-error-border text-[11px] font-bold text-error tracking-[0.08em] uppercase">
                  Disconnect
                </motion.button>
              </div>
            </>
          )}

          {/* Connect Solana Wallet Button */}
          {!solanaWallet.connected && (
            <motion.button whileTap={{ scale: 0.97 }}
              onClick={() => {
                if (IS_EMBEDDED_WALLET && setShowWalletSetup && setShowWalletUnlock) {
                  if (embeddedWallet?.state === 'locked') setShowWalletUnlock(true);
                  else setShowWalletSetup(true);
                } else {
                  setShowWalletModal(true);
                }
              }}
              className="w-full py-3 rounded-[14px] flex items-center justify-center gap-2 mt-2 bg-accent text-accent-text text-[14px] font-extrabold tracking-[-0.01em]">
              <Wallet size={16} className="text-accent-text" /> Connect Wallet
            </motion.button>
          )}
        </div>

        {/* Bank Accounts */}
        <div className="flex items-center justify-between mb-2">
          <p className={SECTION_LABEL}>Bank Accounts</p>
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowAddBank(true)}
            className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-surface-raised border border-border-subtle">
            <Plus size={15} className="text-text-secondary" />
          </motion.button>
        </div>
        <div className="flex flex-col gap-2 mb-3">
          {bankAccounts.map(acc => (
            <div key={acc.id} className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${CARD}`}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-active text-[18px]">
                {'\uD83C\uDFE6'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-bold text-text-primary tracking-[-0.01em]">{acc.bank}</p>
                  {acc.isDefault && (
                    <span className="text-[8px] font-extrabold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded-full bg-accent text-accent-text">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-text-tertiary font-mono">{acc.iban}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Trade History & Statement ── */}
        <p className={`${SECTION_LABEL} block mb-2`}>Trade History</p>

        {/* Period Filters */}
        <div className="flex gap-1.5 mb-3">
          {PERIOD_OPTIONS.map(opt => (
            <motion.button
              key={opt.key}
              whileTap={{ scale: 0.95 }}
              onClick={() => setTradePeriod(opt.key)}
              className={`flex-1 py-2 rounded-[12px] text-[11px] font-bold tracking-[0.05em] uppercase transition-colors ${
                tradePeriod === opt.key
                  ? 'bg-accent text-accent-text'
                  : 'bg-surface-hover text-text-tertiary border border-border-medium'
              }`}
            >
              {opt.label}
            </motion.button>
          ))}
        </div>

        {/* Summary Card */}
        <div className={`rounded-[18px] p-4 mb-3 ${CARD}`}>
          <div className="flex items-center justify-between mb-3">
            <p className={CARD_LABEL}>Summary</p>
            <div className="flex gap-1.5">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowStatement(v => !v)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] bg-surface-active text-[10px] font-bold text-text-secondary tracking-[0.05em] uppercase"
              >
                <Eye size={12} /> View
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleDownloadStatement}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] bg-accent text-[10px] font-bold text-accent-text tracking-[0.05em] uppercase"
              >
                <Download size={12} /> Download
              </motion.button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Previous Balance', value: `${tradeSummary.previousBalance.toFixed(2)}`, suffix: 'USDT' },
              { label: 'Total Credits', value: `+${tradeSummary.totalCredits.toFixed(2)}`, suffix: 'USDT', color: 'text-success' },
              { label: 'Total Debits', value: `-${tradeSummary.totalDebits.toFixed(2)}`, suffix: 'USDT', color: 'text-error' },
              { label: 'Closing Balance', value: tradeSummary.closingBalance.toFixed(2), suffix: 'USDT' },
            ].map(item => (
              <div key={item.label} className="rounded-[14px] px-3 py-2 bg-surface-hover border border-border-medium">
                <p className="text-[8px] font-bold tracking-[0.15em] text-text-quaternary uppercase mb-0.5">{item.label}</p>
                <p className={`text-[15px] font-extrabold tracking-[-0.02em] ${item.color || 'text-text-primary'}`}>
                  {item.value} <span className="text-[10px] font-bold text-text-quaternary">{item.suffix}</span>
                </p>
              </div>
            ))}
          </div>

          <div className="flex gap-3 mt-2 pt-2 border-t border-border-medium">
            {[
              { label: 'Total', value: tradeSummary.totalTrades },
              { label: 'Completed', value: tradeSummary.completedTrades },
              { label: 'Cancelled', value: tradeSummary.cancelledTrades },
              { label: 'Disputed', value: tradeSummary.disputedTrades },
            ].map(s => (
              <div key={s.label} className="flex-1 text-center">
                <p className="text-[14px] font-extrabold text-text-primary">{s.value}</p>
                <p className="text-[8px] font-bold tracking-[0.1em] text-text-quaternary uppercase">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Trade List */}
        {tradesLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={20} className="animate-spin text-text-tertiary" />
          </div>
        ) : allTrades.length === 0 ? (
          <div className={`rounded-[16px] px-4 py-6 text-center mb-3 ${CARD}`}>
            <p className="text-[13px] font-semibold text-text-tertiary">No trades in this period</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 mb-3">
            {allTrades.map(trade => (
              <div key={trade.id} className={`rounded-[16px] px-4 py-3 ${CARD}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${
                    trade.type === 'buy' ? 'bg-success-dim' : 'bg-error-dim'
                  }`}>
                    {trade.type === 'buy'
                      ? <ArrowDownLeft size={14} className="text-success" />
                      : <ArrowUpRight size={14} className="text-error" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-bold text-text-primary tracking-[-0.01em]">
                        {trade.type === 'buy' ? 'Buy' : 'Sell'} {trade.cryptoCode}
                      </p>
                      <span className={`text-[8px] font-bold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded-full border ${getTradeStatusStyle(trade.status)}`}>
                        {trade.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-text-tertiary">
                      {trade.merchant.name} &middot; {new Date(trade.createdAt).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-[14px] font-extrabold tracking-[-0.02em] ${
                      trade.type === 'buy' ? 'text-success' : 'text-error'
                    }`}>
                      {trade.type === 'buy' ? '+' : '-'}{trade.cryptoAmount}
                    </p>
                    <p className="text-[10px] font-semibold text-text-quaternary">
                      {trade.fiatAmount} {trade.fiatCode}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Statement Modal */}
        <AnimatePresence>
          {showStatement && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 z-40"
                onClick={() => setShowStatement(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 40 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className={`fixed inset-0 z-50 m-auto w-[calc(100%-40px)] ${maxW} max-h-[80vh] flex flex-col bg-surface-base border border-border-medium rounded-[20px] shadow-2xl`}
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-text-secondary" />
                    <p className="text-[17px] font-extrabold text-text-primary tracking-[-0.02em]">
                      Statement — {PERIOD_OPTIONS.find(p => p.key === tradePeriod)!.label}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <motion.button whileTap={{ scale: 0.9 }} onClick={handleDownloadStatement}
                      className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-accent">
                      <Download size={14} className="text-accent-text" />
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowStatement(false)}
                      className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-surface-hover">
                      <X size={15} className="text-text-tertiary" />
                    </motion.button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {/* Statement Summary */}
                  <div className="rounded-[14px] p-3 bg-surface-hover border border-border-medium mb-4">
                    <p className={`${CARD_LABEL} mb-2`}>Account Summary</p>
                    {[
                      { label: 'Previous Balance', value: `${tradeSummary.previousBalance.toFixed(2)} USDT` },
                      { label: 'Total Credits (Buys)', value: `+${tradeSummary.totalCredits.toFixed(2)} USDT`, color: 'text-success' },
                      { label: 'Total Debits (Sells)', value: `-${tradeSummary.totalDebits.toFixed(2)} USDT`, color: 'text-error' },
                      { label: 'Closing Balance', value: `${tradeSummary.closingBalance.toFixed(2)} USDT`, bold: true },
                    ].map(row => (
                      <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-border-subtle last:border-0">
                        <p className="text-[12px] font-semibold text-text-tertiary">{row.label}</p>
                        <p className={`text-[13px] font-bold ${row.color || 'text-text-primary'} ${row.bold ? 'text-[14px] font-extrabold' : ''}`}>
                          {row.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Statement Trade Rows */}
                  <p className={`${CARD_LABEL} mb-2`}>Transactions ({allTrades.length})</p>
                  <div className="flex flex-col gap-1">
                    {allTrades.map(trade => (
                      <div key={trade.id} className="flex items-center justify-between py-2 border-b border-border-subtle">
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

        {/* Console & Analytics */}
        <p className={`${SECTION_LABEL} block mb-2`}>Analytics</p>
        <a href="/console" className={`flex items-center gap-3 rounded-[16px] px-4 py-3 mb-3 ${CARD}`}>
          <div className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 bg-surface-active">
            <TrendingUp size={16} className="text-text-secondary" />
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-text-primary tracking-[-0.01em]">Console</p>
            <p className="text-[10px] font-semibold text-text-tertiary tracking-[0.1em] uppercase">Timeouts & Analytics</p>
          </div>
          {timedOutOrders.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-[3px] rounded-full bg-error-dim border border-error-border text-error">
              {timedOutOrders.length} timeout{timedOutOrders.length !== 1 ? 's' : ''}
            </span>
          )}
          <ChevronRight size={15} className="text-text-quaternary" />
        </a>

        {/* Resolved Disputes */}
        {resolvedDisputes.length > 0 && (
          <>
            <p className={`${SECTION_LABEL} block mb-2`}>Resolved Disputes</p>
            <div className="flex flex-col gap-2 mb-3">
              {resolvedDisputes.map(dispute => {
                const badgeClass =
                  dispute.resolvedInFavorOf === 'user'
                    ? 'bg-success-dim text-success border border-success-border'
                    : dispute.resolvedInFavorOf === 'merchant'
                    ? 'bg-error-dim text-error border border-error-border'
                    : 'bg-surface-active text-text-tertiary';
                return (
                  <div key={dispute.id} className={`rounded-[16px] px-4 py-3 ${CARD}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-text-primary">#{dispute.orderNumber}</span>
                        <span className={`text-[9px] font-bold tracking-[0.1em] uppercase px-[7px] py-0.5 rounded-full ${badgeClass}`}>
                          {dispute.resolvedInFavorOf === 'user' ? 'Won' :
                           dispute.resolvedInFavorOf === 'merchant' ? 'Lost' : 'Split'}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-tertiary">
                        {new Date(dispute.resolvedAt).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[12px] text-text-tertiary">vs {dispute.otherPartyName}</p>
                      <p className="text-[14px] font-extrabold text-text-primary tracking-[-0.01em]">
                        ${dispute.cryptoAmount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Theme Toggle */}
        <p className={`${SECTION_LABEL} block mb-2`}>Appearance</p>
        <div className={`rounded-[16px] px-4 py-3 flex items-center justify-between mb-3 ${CARD}`}>
          <div className="flex items-center gap-3">
            {theme === 'dark' ? (
              <Moon size={16} className="text-text-secondary" />
            ) : (
              <Sun size={16} className="text-text-secondary" />
            )}
            <span className="text-[14px] font-bold text-text-primary">
              {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
            </span>
          </div>
          <button onClick={toggleTheme}>
            <div className="w-12 h-7 rounded-[14px] p-0.5 flex items-center transition-colors duration-200 bg-accent">
              <div className={`w-6 h-6 rounded-full bg-surface-base transition-transform duration-200 ${
                theme === 'light' ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </div>
          </button>
        </div>

        {/* Logout */}
        <motion.button whileTap={{ scale: 0.97 }}
          onClick={() => {
            console.log('[User] Signing out...');
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
            if (solanaWallet.disconnect) {
              solanaWallet.disconnect();
            }
            window.location.href = '/';
          }}
          className="w-full h-12 flex items-center justify-center gap-2 rounded-[14px] bg-error-dim border border-error-border text-[14px] font-extrabold text-error tracking-[-0.01em]">
          <LogOut size={16} className="text-error" />
          Sign Out
        </motion.button>
      </div>

      {/* Add Bank Modal */}
      <AnimatePresence>
        {showAddBank && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
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
                className={`w-full ${maxW} rounded-2xl shadow-2xl bg-surface-base border border-border-medium`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
                  <p className="text-[17px] font-extrabold text-text-primary tracking-[-0.02em]">Add Bank Account</p>
                  <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowAddBank(false)}
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-surface-hover">
                    <X size={15} className="text-text-tertiary" />
                  </motion.button>
                </div>
                <div className="px-5 py-4 flex flex-col gap-3">
                  <div>
                    <p className={`${CARD_LABEL} block mb-1.5`}>Bank Name</p>
                    <input
                      value={newBank.bank}
                      onChange={(e) => setNewBank(p => ({ ...p, bank: e.target.value }))}
                      placeholder="Emirates NBD"
                      className="w-full bg-surface-hover border border-border-medium rounded-[12px] px-3.5 py-2.5 text-[14px] font-semibold text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-strong"
                    />
                  </div>
                  <div>
                    <p className={`${CARD_LABEL} block mb-1.5`}>IBAN</p>
                    <input
                      value={newBank.iban}
                      onChange={(e) => setNewBank(p => ({ ...p, iban: e.target.value }))}
                      placeholder="AE12 0345 0000 0012 3456 789"
                      className="w-full bg-surface-hover border border-border-medium rounded-[12px] px-3.5 py-2.5 text-[14px] font-semibold text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-strong"
                    />
                  </div>
                  <div>
                    <p className={`${CARD_LABEL} block mb-1.5`}>Account Name</p>
                    <input
                      value={newBank.name}
                      onChange={(e) => setNewBank(p => ({ ...p, name: e.target.value }))}
                      placeholder="John Doe"
                      className="w-full bg-surface-hover border border-border-medium rounded-[12px] px-3.5 py-2.5 text-[14px] font-semibold text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-strong"
                    />
                  </div>
                </div>
                <div className="px-5 pb-5 pt-1">
                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={addBankAccount}
                    disabled={!newBank.bank || !newBank.iban || !newBank.name}
                    className={`w-full h-12 rounded-[14px] text-[14px] font-extrabold tracking-[-0.01em] ${
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
