'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowLeft, ArrowUpRight, Lock, Unlock, RotateCcw,
  Receipt, Search, RefreshCw, ExternalLink, TrendingUp, CheckCircle,
  AlertTriangle, Loader2, ChevronDown, Shield, Coins, X,
  Clock, ShoppingCart, Ban, Gavel, Timer,
  type LucideIcon,
} from 'lucide-react';
import { getSolscanTxUrl } from '@/lib/explorer';
import { usePusherOptional } from '@/context/PusherContext';
import { getAllMerchantsChannel } from '@/lib/pusher/channels';
import { ORDER_EVENTS } from '@/lib/pusher/events';

// ── Types ──────────────────────────────────────────────────────────────────────

interface UnifiedTransaction {
  id: string;
  source: 'order' | 'onchain' | 'inapp';
  timestamp: string;
  order_id: string | null;
  order_number: string | null;
  status: string | null;
  amount: number;
  fiat_amount: number | null;
  crypto_currency: string | null;
  fiat_currency: string | null;
  type: string;
  type_label: string;
  description: string;
  tx_hash: string | null;
  tx_type: 'escrow' | 'release' | 'refund' | null;
  escrow_trade_pda: string | null;
  escrow_creator_wallet: string | null;
  balance_before: number | null;
  balance_after: number | null;
  rate: number | null;
  order_type: string | null;
  payment_method: string | null;
  counterparty: string | null;
  seller_name: string | null;
  buyer_name: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  escrowed_at: string | null;
  payment_sent_at: string | null;
  created_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

interface Summary {
  total_volume: number;
  completed_count: number;
  in_escrow_amount: number;
  disputed_count: number;
}

type Tab = 'all' | 'orders' | 'onchain' | 'disputed';

// ── Constants ──────────────────────────────────────────────────────────────────

const TAB_LABELS: Record<Tab, string> = {
  all: 'All',
  orders: 'Orders',
  onchain: 'On-chain',
  disputed: 'Disputed',
};

const TX_ICONS: Record<string, LucideIcon> = {
  trade_intent: ArrowUpRight,
  escrow_lock: Lock,
  escrow_release: Unlock,
  escrow_refund: RotateCcw,
  order_completed: CheckCircle,
  order_cancelled: Ban,
  fee_deduction: Receipt,
  synthetic_conversion: ArrowUpRight,
  manual_adjustment: Coins,
  order_open: ShoppingCart,
  order_accepted: Clock,
  order_escrowed: Lock,
  order_payment_sent: ArrowUpRight,
  order_completed_status: CheckCircle,
  order_cancelled_status: Ban,
  order_disputed: Gavel,
  order_expired: Timer,
};

const TX_COLORS: Record<string, string> = {
  trade_intent: 'cyan',
  escrow_lock: 'orange',
  escrow_release: 'green',
  escrow_refund: 'blue',
  order_completed: 'emerald',
  order_cancelled: 'red',
  fee_deduction: 'yellow',
  synthetic_conversion: 'violet',
  manual_adjustment: 'gray',
  order_open: 'blue',
  order_accepted: 'yellow',
  order_escrowed: 'purple',
  order_payment_sent: 'orange',
  order_completed_status: 'green',
  order_cancelled_status: 'red',
  order_disputed: 'red',
  order_expired: 'gray',
};

const STATUS_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  open:         { bg: 'bg-blue-500/20',   text: 'text-blue-400',   label: 'OPEN' },
  accepted:     { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'ACCEPTED' },
  escrowed:     { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'ESCROWED' },
  payment_sent: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'PAYMENT SENT' },
  completed:    { bg: 'bg-green-500/20',  text: 'text-green-400',  label: 'COMPLETED' },
  cancelled:    { bg: 'bg-red-500/20',    text: 'text-red-400',    label: 'CANCELLED' },
  expired:      { bg: 'bg-gray-500/20',   text: 'text-gray-400',   label: 'EXPIRED' },
  disputed:     { bg: 'bg-red-500/20',    text: 'text-red-400',    label: 'DISPUTED' },
};

const STATUS_OPTIONS = ['all', 'open', 'accepted', 'escrowed', 'payment_sent', 'completed', 'cancelled', 'expired', 'disputed'];
const LIMIT = 50;

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatAmount(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

// Stuck detection: how long an order has been in its current state
function getStuckInfo(tx: UnifiedTransaction): { isStuck: boolean; stuckMinutes: number; stuckLabel: string } | null {
  if (tx.source !== 'order') return null;
  const status = tx.status;
  if (!status || ['completed', 'cancelled', 'expired'].includes(status)) return null;

  const now = Date.now();
  let enteredAt: number | null = null;
  let thresholdMin = 30;

  if (status === 'open') {
    enteredAt = tx.created_at ? new Date(tx.created_at).getTime() : null;
    thresholdMin = 60; // 1hr unmatched
  } else if (status === 'accepted') {
    enteredAt = tx.accepted_at ? new Date(tx.accepted_at).getTime() : null;
    thresholdMin = 10; // seller should lock escrow fast
  } else if (status === 'escrowed') {
    enteredAt = tx.escrowed_at ? new Date(tx.escrowed_at).getTime() : null;
    thresholdMin = 30; // buyer should send payment
  } else if (status === 'payment_sent') {
    enteredAt = tx.payment_sent_at ? new Date(tx.payment_sent_at).getTime() : null;
    thresholdMin = 30; // seller should confirm
  } else if (status === 'disputed') {
    enteredAt = tx.created_at ? new Date(tx.created_at).getTime() : null;
    thresholdMin = 60;
  }

  if (!enteredAt) return null;
  const diffMin = Math.floor((now - enteredAt) / 60000);

  const labels: Record<string, string> = {
    open: 'No one accepted',
    accepted: 'Escrow not locked',
    escrowed: 'Payment not sent',
    payment_sent: 'Not confirmed',
    disputed: 'Dispute unresolved',
  };

  return {
    isStuck: diffMin >= thresholdMin,
    stuckMinutes: diffMin,
    stuckLabel: labels[status] || '',
  };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, color, isCurrency }: {
  icon: LucideIcon; label: string; value: number; color: string; isCurrency?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-4"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-${color}-500/10`}>
          <Icon className={`w-4 h-4 text-${color}-400`} />
        </div>
        <span className="text-[11px] text-white/40 uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold text-white/90 font-mono">
        {isCurrency ? formatAmount(value) : value.toLocaleString()}
      </p>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGES[status] || STATUS_BADGES.open;
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text} border border-white/5 font-semibold uppercase tracking-wide`}>
      {cfg.label}
    </span>
  );
}

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [timeLeft, setTimeLeft] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);

  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft('EXPIRED');
        setIsUrgent(true);
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
      setIsUrgent(mins < 5);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
      isUrgent ? 'bg-red-500/20 text-red-400 animate-pulse' : 'bg-yellow-500/15 text-yellow-400'
    }`}>
      <Timer className="w-3 h-3" />
      {timeLeft}
    </span>
  );
}

function StepIndicator({ tx }: { tx: UnifiedTransaction }) {
  if (tx.source !== 'order') return null;

  const steps = [
    { key: 'open', label: 'Open', done: true },
    { key: 'accepted', label: 'Accepted', done: !!tx.accepted_at },
    { key: 'escrowed', label: 'Escrowed', done: !!tx.escrowed_at },
    { key: 'payment_sent', label: 'Fiat Sent', done: !!tx.payment_sent_at },
    { key: 'completed', label: 'Done', done: !!tx.completed_at },
  ];

  // Cancelled/disputed override
  if (tx.status === 'cancelled' || tx.status === 'expired') {
    return (
      <div className="flex items-center gap-1 mt-1.5">
        {steps.map((s, i) => {
          const isCancelledAt = !s.done && i === steps.findIndex(x => !x.done);
          return (
            <div key={s.key} className="flex items-center gap-1">
              {i > 0 && <div className="w-3 h-[1px] bg-white/10" />}
              <div className={`w-1.5 h-1.5 rounded-full ${
                s.done ? 'bg-green-400/60' : isCancelledAt ? 'bg-red-400' : 'bg-white/10'
              }`} />
              <span className={`text-[8px] ${
                s.done ? 'text-green-400/50' : isCancelledAt ? 'text-red-400' : 'text-white/15'
              }`}>{isCancelledAt ? (tx.status === 'cancelled' ? 'Cancelled' : 'Expired') : s.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 mt-1.5">
      {steps.map((s, i) => {
        const isCurrent = s.done && (i === steps.length - 1 || !steps[i + 1].done);
        return (
          <div key={s.key} className="flex items-center gap-1">
            {i > 0 && <div className={`w-3 h-[1px] ${s.done ? 'bg-green-400/30' : 'bg-white/10'}`} />}
            <div className={`w-1.5 h-1.5 rounded-full ${
              s.done ? (isCurrent ? 'bg-orange-400 animate-pulse' : 'bg-green-400/60') : 'bg-white/10'
            }`} />
            <span className={`text-[8px] ${
              isCurrent ? 'text-orange-400 font-bold' : s.done ? 'text-green-400/50' : 'text-white/15'
            }`}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function TransactionRow({ tx, index }: { tx: UnifiedTransaction; index: number }) {
  const Icon = TX_ICONS[tx.type] || ArrowUpRight;
  const color = TX_COLORS[tx.type] || 'gray';
  const isCredit = tx.amount > 0;
  const stuckInfo = getStuckInfo(tx);

  const displaySign = tx.source === 'onchain'
    ? (tx.tx_type === 'escrow' ? '-' : '+')
    : tx.source === 'order'
    ? ''
    : (isCredit ? '+' : '');

  const amountColor = tx.source === 'onchain'
    ? (tx.tx_type === 'escrow' ? 'text-red-400' : 'text-green-400')
    : tx.source === 'order'
    ? 'text-white/70'
    : (isCredit ? 'text-green-400' : 'text-red-400');

  const isActive = tx.source === 'order' && tx.status && !['completed', 'cancelled', 'expired'].includes(tx.status);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.5) }}
      className={`glass-card rounded-xl p-3 sm:p-4 hover-lift transition-all ${
        stuckInfo?.isStuck ? 'border border-red-500/20' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 bg-${color}-500/10 border border-${color}-500/20`}>
          <Icon className={`w-4 h-4 sm:w-5 sm:h-5 text-${color}-400`} />
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          {/* Row 1: Status + badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {tx.order_number && (
              <span className="text-[10px] text-white/30 font-mono font-bold">#{tx.order_number}</span>
            )}
            {tx.status && <StatusBadge status={tx.status} />}
            {tx.source === 'order' && tx.order_type && (
              <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                tx.order_type === 'buy'
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}>
                {tx.order_type}
              </span>
            )}
            {tx.source === 'onchain' && (
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono font-bold tracking-wider">
                ON-CHAIN
              </span>
            )}
            {stuckInfo?.isStuck && (
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 font-bold uppercase tracking-wider animate-pulse">
                STUCK {stuckInfo.stuckMinutes}m
              </span>
            )}
          </div>

          {/* Row 2: Parties — clear "Seller → Buyer" */}
          {tx.source === 'order' && (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] text-white/25 uppercase tracking-wider">Seller</span>
              <span className="text-xs font-semibold text-orange-400/80 truncate max-w-[100px] sm:max-w-[140px]">{tx.seller_name || '?'}</span>
              <span className="text-white/20 text-xs mx-0.5">&rarr;</span>
              <span className="text-[10px] text-white/25 uppercase tracking-wider">Buyer</span>
              <span className="text-xs font-semibold text-blue-400/80 truncate max-w-[100px] sm:max-w-[140px]">{tx.buyer_name || '?'}</span>
            </div>
          )}

          {/* Row 3: Step progress for orders */}
          <StepIndicator tx={tx} />

          {/* Row 4: Stuck reason */}
          {stuckInfo?.isStuck && stuckInfo.stuckLabel && (
            <p className="text-[10px] text-red-400/70 mt-0.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {stuckInfo.stuckLabel} for {stuckInfo.stuckMinutes}m
            </p>
          )}

          {/* Row 5: Metadata */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {tx.source === 'order' && tx.payment_method && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-white/[0.04] text-white/25 uppercase">{tx.payment_method}</span>
            )}
            {tx.tx_hash && (
              <a
                href={getSolscanTxUrl(tx.tx_hash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] text-purple-400/70 hover:text-purple-300 font-mono transition-colors"
              >
                {truncateHash(tx.tx_hash)}
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>
        </div>

        {/* Amount + Timer + Time */}
        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <p className={`text-base font-bold font-mono ${amountColor}`}>
            {displaySign}{formatAmount(Math.abs(tx.amount))}
          </p>
          <p className="text-[10px] text-white/20 font-mono">
            {tx.crypto_currency || 'USDT'}
          </p>
          {tx.fiat_amount != null && tx.fiat_amount > 0 && (
            <p className="text-[10px] text-white/15 font-mono hidden sm:block">
              {formatAmount(tx.fiat_amount)} {tx.fiat_currency || 'AED'}
            </p>
          )}
          {/* Countdown timer for active orders */}
          {isActive && tx.expires_at && (
            <CountdownTimer expiresAt={tx.expires_at} />
          )}
          <p className="text-[10px] text-white/20">{formatDate(tx.timestamp)}</p>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<UnifiedTransaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  const [tab, setTab] = useState<Tab>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowStatusDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fetch — no merchant_id = admin mode (ALL orders)
  const fetchTransactions = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset;
    if (reset) setOffset(0);

    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(currentOffset),
        tab,
      });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search) params.set('search', search);

      const res = await fetch(`/api/transactions?${params}`);
      const data = await res.json();
      if (data.success) {
        setTransactions(prev => currentOffset === 0 ? data.data.transactions : [...prev, ...data.data.transactions]);
        setSummary(data.data.summary);
        setTotal(data.data.total);
      }
    } catch (err) {
      console.error('[Transactions] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [offset, tab, statusFilter, search]);

  // Fetch on mount and filter changes
  useEffect(() => {
    fetchTransactions(true);
  }, [tab, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchTransactions(true);
    }, 400);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load more
  const loadMore = () => {
    const newOffset = offset + LIMIT;
    setOffset(newOffset);
  };
  useEffect(() => {
    if (offset > 0) fetchTransactions();
  }, [offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = () => {
    setRefreshing(true);
    fetchTransactions(true);
  };

  // Real-time: refetch on any order event via global merchant channel
  const pusher = usePusherOptional();
  useEffect(() => {
    if (!pusher || !pusher.isConnected) return;

    const ch = pusher.subscribe(getAllMerchantsChannel());
    if (!ch) return;

    const handler = () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      searchTimeout.current = setTimeout(() => fetchTransactions(true), 500);
    };

    ch.bind(ORDER_EVENTS.CREATED, handler);
    ch.bind(ORDER_EVENTS.STATUS_UPDATED, handler);
    ch.bind(ORDER_EVENTS.CANCELLED, handler);

    return () => {
      ch.unbind(ORDER_EVENTS.CREATED, handler);
      ch.unbind(ORDER_EVENTS.STATUS_UPDATED, handler);
      ch.unbind(ORDER_EVENTS.CANCELLED, handler);
      pusher.unsubscribe(getAllMerchantsChannel());
    };
  }, [pusher, pusher?.isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-[var(--background)] degen-bg">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/60 backdrop-blur-2xl border-b border-white/[0.05]">
        <div className="h-12 md:h-[50px] flex items-center px-3 md:px-4 gap-3 max-w-5xl mx-auto">
          <Link
            href="/merchant"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.04] transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </Link>
          <h1 className="text-base font-semibold text-white/90 flex-1">All Transactions</h1>
          <span className="text-[10px] px-2 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 font-mono font-bold">
            ADMIN
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.04] transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-white/40 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-3 sm:px-4 lg:px-6 py-5 space-y-5">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard icon={TrendingUp} label="Volume" value={summary.total_volume} color="orange" isCurrency />
            <SummaryCard icon={CheckCircle} label="Completed" value={summary.completed_count} color="green" />
            <SummaryCard icon={Shield} label="In Escrow" value={summary.in_escrow_amount} color="purple" isCurrency />
            <SummaryCard icon={AlertTriangle} label="Disputed" value={summary.disputed_count} color="red" />
          </div>
        )}

        {/* Tab Bar */}
        <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-lg p-[3px] border border-white/[0.05]">
          {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                tab === t
                  ? 'bg-white/[0.08] text-white/90 shadow-sm'
                  : 'text-white/35 hover:text-white/50 hover:bg-white/[0.03]'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-col sm:flex-row">
          {/* Search */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
            <input
              placeholder="Search order #, tx hash, merchant name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-white/[0.03] border border-white/[0.07] rounded-lg text-sm text-white/80 placeholder-white/20 focus:border-orange-500/30 focus:outline-none transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X className="w-2.5 h-2.5 text-white/50" />
              </button>
            )}
          </div>

          {/* Status Dropdown */}
          <div className="relative w-full sm:w-44" ref={dropdownRef}>
            <button
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.03] border border-white/[0.07] rounded-lg text-sm text-white/60 hover:border-white/[0.12] transition-colors"
            >
              <span className="capitalize">{statusFilter === 'all' ? 'All Statuses' : statusFilter.replace('_', ' ')}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showStatusDropdown ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {showStatusDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute top-full mt-1 left-0 right-0 z-50 bg-[#0c0c0c] border border-white/[0.08] rounded-lg overflow-hidden shadow-xl"
                >
                  {STATUS_OPTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => { setStatusFilter(s); setShowStatusDropdown(false); }}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                        statusFilter === s
                          ? 'bg-orange-500/10 text-orange-400'
                          : 'text-white/50 hover:bg-white/[0.04] hover:text-white/70'
                      }`}
                    >
                      <span className="capitalize">{s === 'all' ? 'All Statuses' : s.replace('_', ' ')}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Transaction List */}
        <div className="space-y-2">
          {loading && transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-6 h-6 text-orange-500/50 animate-spin" />
              <p className="text-xs text-white/25">Loading transactions...</p>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Receipt className="w-8 h-8 text-white/10" />
              <p className="text-sm text-white/30">No transactions found</p>
              <p className="text-xs text-white/15">Try changing your filters or search query</p>
            </div>
          ) : (
            <>
              <AnimatePresence mode="popLayout">
                {transactions.map((tx, i) => (
                  <TransactionRow key={tx.id} tx={tx} index={i} />
                ))}
              </AnimatePresence>

              {/* Load More */}
              {transactions.length < total && (
                <div className="flex justify-center pt-4 pb-8">
                  <button
                    onClick={loadMore}
                    disabled={loading}
                    className="px-6 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/50 hover:bg-white/[0.06] hover:text-white/70 hover:border-white/[0.12] transition-all disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                    ) : (
                      `Load More (${transactions.length}/${total})`
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer spacer */}
        <div className="h-8" />
      </main>
    </div>
  );
}
