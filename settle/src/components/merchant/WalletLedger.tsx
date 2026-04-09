'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wallet, ArrowUpRight, ArrowDownRight, Download, ChevronDown,
  ChevronLeft, ChevronRight, Loader2, BookOpen, Filter,
  TrendingUp, TrendingDown, RefreshCw,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

// ─── Types ───────────────────────────────────────────────────────────

interface LedgerEntry {
  id: string;
  entry_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  description: string | null;
  related_order_id: string | null;
  order_number: string | null;
  order_type: 'buy' | 'sell' | null;
  counterparty_name: string | null;
  created_at: string;
}

interface LedgerSummary {
  current_balance: number;
  total_credits: number;
  total_debits: number;
  total_transactions: number;
}

interface Pagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

interface WalletLedgerProps {
  merchantId: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const TIME_RANGES = [
  { value: '1', label: 'Last 24h' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

const TX_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'ESCROW_LOCK', label: 'Escrow Lock' },
  { value: 'ESCROW_RELEASE', label: 'Escrow Release' },
  { value: 'ESCROW_REFUND', label: 'Refund' },
  { value: 'ORDER_PAYMENT', label: 'Order Payment' },
  { value: 'ORDER_RECEIPT', label: 'Order Receipt' },
  { value: 'DEPOSIT', label: 'Deposit' },
  { value: 'WITHDRAWAL', label: 'Withdrawal' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
  { value: 'SYNTHETIC_CONVERSION', label: 'Conversion' },
];

const PAGE_SIZE = 25;

// ─── Helpers ─────────────────────────────────────────────────────────

function formatUSDT(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function getTypeLabel(entryType: string): string {
  const map: Record<string, string> = {
    ESCROW_LOCK: 'Escrow Locked',
    ESCROW_RELEASE: 'Escrow Released',
    ESCROW_REFUND: 'Escrow Refunded',
    ORDER_PAYMENT: 'Order Payment',
    ORDER_RECEIPT: 'Order Receipt',
    DEPOSIT: 'Deposit',
    WITHDRAWAL: 'Withdrawal',
    ADJUSTMENT: 'Adjustment',
    SYNTHETIC_CONVERSION: 'Conversion',
    CORRIDOR_SAED_LOCK: 'Corridor Lock',
    CORRIDOR_SAED_TRANSFER: 'Corridor Transfer',
    CORRIDOR_FEE: 'Corridor Fee',
  };
  return map[entryType] || entryType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getTypeColor(entryType: string, amount: number): { text: string; bg: string; border: string } {
  if (entryType === 'CORRIDOR_FEE') return { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
  if (entryType === 'ESCROW_REFUND') return { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' };
  if (amount >= 0) return { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
  return { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' };
}

function exportToCSV(entries: LedgerEntry[], summary: LedgerSummary) {
  const headers = ['Date', 'Time', 'Type', 'Description', 'Order #', 'Counterparty', 'Amount (USDT)', 'Balance Before', 'Balance After'];
  const rows = entries.map(e => [
    formatDate(e.created_at),
    formatTime(e.created_at),
    getTypeLabel(e.entry_type),
    e.description || '',
    e.order_number || '',
    e.counterparty_name || '',
    e.amount.toFixed(2),
    e.balance_before.toFixed(2),
    e.balance_after.toFixed(2),
  ]);

  const summaryRows = [
    [],
    ['Summary'],
    ['Current Balance', summary.current_balance.toFixed(2)],
    ['Total Credits', summary.total_credits.toFixed(2)],
    ['Total Debits', summary.total_debits.toFixed(2)],
    ['Total Transactions', summary.total_transactions.toString()],
  ];

  const csv = [headers, ...rows, ...summaryRows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `wallet-ledger-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Component ───────────────────────────────────────────────────────

export function WalletLedger({ merchantId }: WalletLedgerProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('all');
  const [txType, setTxType] = useState('all');
  const [page, setPage] = useState(0);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);

  const fetchLedger = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        merchant_id: merchantId,
        limit: PAGE_SIZE.toString(),
        offset: (page * PAGE_SIZE).toString(),
      });

      if (timeRange !== 'all') {
        params.set('days', timeRange);
      }
      if (txType !== 'all') {
        params.set('type', txType);
      }

      const res = await fetchWithAuth(`/api/merchant/wallet-ledger?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setEntries(data.data.entries || []);
          setSummary(data.data.summary || null);
          setPagination(data.data.pagination || null);
        }
      }
    } catch (error) {
      console.error('Failed to fetch wallet ledger:', error);
    } finally {
      setIsLoading(false);
    }
  }, [merchantId, timeRange, txType, page]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [timeRange, txType]);

  const totalPages = pagination ? Math.ceil(pagination.total / PAGE_SIZE) : 0;

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Wallet className="w-4 h-4" />
              </span>
              <span className="text-xs text-white/50">Current Balance</span>
            </div>
            <p className="text-2xl font-bold text-white font-mono tabular-nums">
              {formatUSDT(summary.current_balance)}
            </p>
            <p className="text-[10px] text-white/35 mt-1">USDT</p>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <TrendingUp className="w-4 h-4" />
              </span>
              <span className="text-xs text-white/50">Total Credits</span>
            </div>
            <p className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">
              +{formatUSDT(summary.total_credits)}
            </p>
            <p className="text-[10px] text-white/35 mt-1">USDT</p>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <span className="p-1.5 rounded-lg bg-red-500/10 text-red-400">
                <TrendingDown className="w-4 h-4" />
              </span>
              <span className="text-xs text-white/50">Total Debits</span>
            </div>
            <p className="text-2xl font-bold text-red-400 font-mono tabular-nums">
              -{formatUSDT(summary.total_debits)}
            </p>
            <p className="text-[10px] text-white/35 mt-1">USDT</p>
          </div>
        </div>
      )}

      {/* Filters & Actions Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Time Range Filter */}
          <div className="relative">
            <button
              onClick={() => { setShowTimeDropdown(!showTimeDropdown); setShowTypeDropdown(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-lg text-sm text-white/80
                         hover:bg-white/10 transition-colors border border-white/10"
            >
              <Filter className="w-3.5 h-3.5 text-white/40" />
              {TIME_RANGES.find(t => t.value === timeRange)?.label}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showTimeDropdown && (
              <div className="absolute left-0 top-full mt-1 bg-zinc-800 rounded-lg shadow-xl border border-white/10 py-1 z-20 min-w-[140px]">
                {TIME_RANGES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => { setTimeRange(t.value); setShowTimeDropdown(false); }}
                    className={`w-full px-3 py-1.5 text-sm text-left hover:bg-white/10 transition-colors
                      ${timeRange === t.value ? 'text-emerald-400' : 'text-white/80'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Type Filter */}
          <div className="relative">
            <button
              onClick={() => { setShowTypeDropdown(!showTypeDropdown); setShowTimeDropdown(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-lg text-sm text-white/80
                         hover:bg-white/10 transition-colors border border-white/10"
            >
              {TX_TYPES.find(t => t.value === txType)?.label}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showTypeDropdown && (
              <div className="absolute left-0 top-full mt-1 bg-zinc-800 rounded-lg shadow-xl border border-white/10 py-1 z-20 min-w-[160px]">
                {TX_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => { setTxType(t.value); setShowTypeDropdown(false); }}
                    className={`w-full px-3 py-1.5 text-sm text-left hover:bg-white/10 transition-colors
                      ${txType === t.value ? 'text-emerald-400' : 'text-white/80'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh */}
          <button
            onClick={fetchLedger}
            disabled={isLoading}
            className="p-1.5 bg-white/5 rounded-lg text-white/60 hover:bg-white/10 hover:text-white/80
                       transition-colors border border-white/10 disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {/* Export CSV */}
          {entries.length > 0 && summary && (
            <button
              onClick={() => exportToCSV(entries, summary)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-lg text-sm text-white/70
                         hover:bg-white/10 hover:text-white/90 transition-colors border border-white/10"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          )}
        </div>
      </div>

      {/* Close dropdowns on outside click */}
      {(showTimeDropdown || showTypeDropdown) && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => { setShowTimeDropdown(false); setShowTypeDropdown(false); }}
        />
      )}

      {/* Ledger Table */}
      <div className="bg-white/[0.03] rounded-xl border border-white/10 overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[1fr_140px_120px_120px_120px] gap-2 px-4 py-2.5 border-b border-white/10 bg-white/[0.03]">
          <span className="text-[11px] font-bold text-white/40 uppercase tracking-wider">Transaction</span>
          <span className="text-[11px] font-bold text-white/40 uppercase tracking-wider text-right">Amount</span>
          <span className="text-[11px] font-bold text-white/40 uppercase tracking-wider text-right">Before</span>
          <span className="text-[11px] font-bold text-white/40 uppercase tracking-wider text-right">After</span>
          <span className="text-[11px] font-bold text-white/40 uppercase tracking-wider text-right">Date</span>
        </div>

        {/* Table Body */}
        {isLoading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-white/20" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white/40">No transactions found</p>
              <p className="text-xs text-white/25 mt-1">
                {txType !== 'all' || timeRange !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Transactions will appear here after your first trade'}
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {entries.map((entry) => {
              const isPositive = entry.amount >= 0;
              const colors = getTypeColor(entry.entry_type, entry.amount);

              return (
                <div
                  key={entry.id}
                  className="grid grid-cols-[1fr_140px_120px_120px_120px] gap-2 px-4 py-3 hover:bg-white/[0.03] transition-colors items-center"
                >
                  {/* Transaction Info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${colors.bg} ${colors.border}`}>
                      {isPositive ? (
                        <ArrowDownRight className={`w-4 h-4 ${colors.text}`} />
                      ) : (
                        <ArrowUpRight className={`w-4 h-4 ${colors.text}`} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white/90 truncate">
                        {getTypeLabel(entry.entry_type)}
                      </p>
                      <p className="text-[11px] text-white/40 truncate">
                        {entry.order_number ? `#${entry.order_number}` : ''}
                        {entry.counterparty_name ? ` \u00B7 ${entry.counterparty_name}` : ''}
                        {!entry.order_number && !entry.counterparty_name ? (entry.description || '\u2014') : ''}
                      </p>
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="text-right">
                    <p className={`text-sm font-bold font-mono tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isPositive ? '+' : ''}{formatUSDT(entry.amount)}
                    </p>
                    <p className="text-[10px] text-white/30 font-mono">USDT</p>
                  </div>

                  {/* Balance Before */}
                  <div className="text-right">
                    <p className="text-sm text-white/50 font-mono tabular-nums">
                      {formatUSDT(entry.balance_before)}
                    </p>
                  </div>

                  {/* Balance After */}
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white/80 font-mono tabular-nums">
                      {formatUSDT(entry.balance_after)}
                    </p>
                  </div>

                  {/* Date */}
                  <div className="text-right">
                    <p className="text-xs text-white/60">{formatDate(entry.created_at)}</p>
                    <p className="text-[10px] text-white/30">{formatTime(entry.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-white/40">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, pagination.total)} of {pagination.total} transactions
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors border border-white/10"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 text-xs text-white/60 font-mono">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={!pagination.has_more}
              className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors border border-white/10"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default WalletLedger;
