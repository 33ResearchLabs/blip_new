'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Activity, DollarSign, Clock, CheckCircle, Copy, ChevronRight, BarChart3, Sun, Moon, Users, ExternalLink } from 'lucide-react';
import { useTradeStream } from './hooks/useTradeStream';
import { solscanTx, networkLabel, isMainnet } from '@/lib/explorer';

interface Trade {
  id: string;
  escrow_address: string;
  merchant_pubkey: string;
  buyer_pubkey: string | null;
  amount: string;
  fee_bps: number;
  mint_address: string;
  status: string;
  created_at: string;
  locked_at: string | null;
  released_at: string | null;
  created_slot: number;
  locked_slot: number | null;
  released_slot: number | null;
  protocol_version?: string;
  lane_id?: number;
}

interface LaneOperation {
  id: string;
  laneId: number;
  merchantWallet: string;
  lanePda: string;
  operation: 'CreateLane' | 'FundLane' | 'WithdrawLane';
  amount: string | null;
  mint: string;
  signature: string;
  slot: string;
  blockTime: string;
  createdAt: string;
}

interface Transaction {
  id: number;
  program_id: string;
  version: string;
  signature: string;
  instruction_type: string;
  trade_pda: string | null;
  slot: number;
  block_time: string;
}

interface Stats {
  total_trades: number;
  total_volume: string;
  active_merchants: number;
  avg_completion_time: number;
}

function UsdtBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
      <svg viewBox="0 0 32 32" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#26A17B" />
        <path
          fill="#FFFFFF"
          d="M17.9 14.8v-2h4.6V9.7H9.5v3.1h4.6v2c-3.7.2-6.5 1-6.5 1.8s2.8 1.6 6.5 1.8v6.5h3.8v-6.5c3.7-.2 6.5-1 6.5-1.8s-2.8-1.6-6.5-1.8zm0 3c-.1 0-.6 0-1.9 0-1 0-1.7 0-2 0-3.1-.1-5.5-.7-5.5-1.3 0-.5 2.3-1.1 5.5-1.3v2.2c.2 0 .9.1 2 .1 1 0 1.8 0 1.9-.1v-2.2c3.1.1 5.5.7 5.5 1.3s-2.3 1.1-5.5 1.3z"
        />
      </svg>
      <span>{children}</span>
    </span>
  );
}

function Sparkline({ points, color = 'currentColor' }: { points: number[]; color?: string }) {
  if (!points.length) return null;
  const max = Math.max(...points, 1);
  const w = 88;
  const h = 24;
  const step = w / Math.max(points.length - 1, 1);
  const path = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${h - (v / max) * h}`)
    .join(' ');
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6 mt-2 overflow-visible" preserveAspectRatio="none">
      <path d={area} fill={color} opacity="0.12" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(!document.documentElement.classList.contains('light'));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('light', !next);
    localStorage.setItem('blipscan-theme', next ? 'dark' : 'light');
  };

  return (
    <button
      onClick={toggle}
      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/[0.06] transition-colors"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <Sun size={15} className="text-foreground/60" /> : <Moon size={15} className="text-foreground/60" />}
    </button>
  );
}

export default function HomePage() {
  const [viewMode, setViewMode] = useState<'trades' | 'transactions' | 'lanes'>('trades');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [laneOperations, setLaneOperations] = useState<LaneOperation[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<'all' | 'funded' | 'locked' | 'released' | 'refunded'>('all');
  const [txFilter, setTxFilter] = useState<string>('all');
  const [laneFilter, setLaneFilter] = useState<'all' | 'CreateLane' | 'FundLane' | 'WithdrawLane'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [analyticsTrades, setAnalyticsTrades] = useState<Trade[]>([]);
  const [flashRows, setFlashRows] = useState<Set<string>>(new Set());

  // Analytics: separately fetch a larger window for sparklines + top merchants
  useEffect(() => {
    fetch('/api/trades?limit=500')
      .then((r) => r.json())
      .then((d) => setAnalyticsTrades(d.trades || []))
      .catch(() => {});
  }, []);

  // Compute 24h hourly sparkline data (count + volume) from analyticsTrades
  const sparkData = (() => {
    const buckets = Array.from({ length: 24 }, () => ({ count: 0, volume: 0 }));
    const now = Date.now();
    for (const t of analyticsTrades) {
      const ts = new Date(t.created_at).getTime();
      const hoursAgo = Math.floor((now - ts) / 3_600_000);
      if (hoursAgo >= 0 && hoursAgo < 24) {
        const idx = 23 - hoursAgo;
        buckets[idx].count += 1;
        buckets[idx].volume += parseInt(t.amount || '0') / 1_000_000;
      }
    }
    return buckets;
  })();

  // 24h derived metrics
  const last24h = (() => {
    const cutoff = Date.now() - 24 * 3_600_000;
    const recent = analyticsTrades.filter(t => new Date(t.created_at).getTime() >= cutoff);
    const volume = recent.reduce((s, t) => s + parseInt(t.amount || '0') / 1_000_000, 0);
    const last = analyticsTrades[0]?.created_at;
    return { count: recent.length, volume, last };
  })();

  // Success rate (released / non-funded outcomes)
  const successRate = (() => {
    let released = 0, finished = 0;
    for (const t of analyticsTrades) {
      const s = (t.status || '').toLowerCase();
      if (s === 'released' || s === 'refunded') {
        finished++;
        if (s === 'released') released++;
      }
    }
    return finished > 0 ? (released / finished) * 100 : 0;
  })();

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 50 | 100>(20);
  useEffect(() => { setPage(1); }, [viewMode, filter, txFilter, laneFilter, searchQuery, pageSize]);

  const fetchTrades = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/trades?status=${filter !== 'all' ? filter : ''}&limit=200`);
      const data = await response.json();
      setTrades(data.trades || []);
    } catch (error) {
      console.error('Error fetching trades:', error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/stats');
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      const instrParam = txFilter !== 'all' ? `&instruction=${txFilter}` : '';
      const response = await fetch(`/api/transactions?limit=100${instrParam}`);
      const data = await response.json();
      setAllTransactions(data.transactions || []);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  }, [txFilter]);

  const fetchLaneOperations = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/lane-operations?operation=${laneFilter !== 'all' ? laneFilter : ''}&limit=50`);
      const data = await response.json();
      setLaneOperations(data.operations || []);
    } catch (error) {
      console.error('Error fetching lane operations:', error);
    } finally {
      setLoading(false);
    }
  }, [laneFilter]);

  useEffect(() => {
    if (viewMode === 'trades') {
      fetchTrades();
    } else if (viewMode === 'transactions') {
      fetchTransactions();
    } else {
      fetchLaneOperations();
    }
    fetchStats();
  }, [viewMode, fetchTrades, fetchTransactions, fetchLaneOperations, fetchStats]);

  // Real-time trade updates via SSE
  useTradeStream(useCallback((event) => {
    if (event.type === 'trade_update' && event.data) {
      const update = event.data;

      // Update trade in list if it exists, or prepend if new
      setTrades(prev => {
        const idx = prev.findIndex(t => t.escrow_address === update.trade_pda);
        if (idx >= 0) {
          // Update existing trade status
          const updated = [...prev];
          updated[idx] = { ...updated[idx], status: update.status };
          return updated;
        }
        // New trade — prepend to list
        const newTrade: Trade = {
          id: update.trade_pda,
          escrow_address: update.trade_pda,
          merchant_pubkey: update.creator,
          buyer_pubkey: update.counterparty,
          amount: update.amount,
          fee_bps: 0,
          mint_address: '',
          status: update.status,
          created_at: update.created_at,
          locked_at: null,
          released_at: null,
          created_slot: 0,
          locked_slot: null,
          released_slot: null,
          protocol_version: 'v2.2',
        };
        return [newTrade, ...prev.slice(0, 49)];
      });

      // Flash the affected row for 1.6s
      setFlashRows((prev) => new Set(prev).add(update.trade_pda));
      setTimeout(() => {
        setFlashRows((prev) => {
          const next = new Set(prev);
          next.delete(update.trade_pda);
          return next;
        });
      }, 1600);

      // Refresh stats on any update
      fetchStats();
    }
  }, [fetchStats]));

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAddress(text);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const addr = (address: string, chars = 4) => {
    if (!address) return '—';
    return `${address.slice(0, chars)}...${address.slice(-chars)}`;
  };

  const formatAmount = (amount: string) => {
    const num = parseInt(amount) / 1_000_000;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatVolume = (amount: string) => {
    const num = parseInt(amount) / 1_000_000;
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
    return `$${num.toFixed(2)}`;
  };

  const timeAgo = (timestamp: string | null) => {
    if (!timestamp) return '—';
    const diff = Date.now() - new Date(timestamp).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  };

  const statusDot = (status: string) => {
    const s = status.toLowerCase();
    const colors: Record<string, string> = {
      funded: 'bg-blue-500',
      locked: 'bg-yellow-500',
      released: 'bg-emerald-500',
      refunded: 'bg-red-500',
    };
    return colors[s] || 'bg-gray-400';
  };

  const statusText = (status: string) => {
    const s = status.toLowerCase();
    const colors: Record<string, string> = {
      funded: 'text-blue-600 dark:text-blue-400',
      locked: 'text-yellow-600 dark:text-yellow-400',
      released: 'text-emerald-600 dark:text-emerald-400',
      refunded: 'text-red-600 dark:text-red-400',
    };
    return colors[s] || 'text-muted-foreground';
  };

  const statusChip = (status: string) => {
    const s = status.toLowerCase();
    const styles: Record<string, string> = {
      funded: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20',
      locked: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 ring-1 ring-inset ring-yellow-500/20',
      released: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/20',
      refunded: 'bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-inset ring-red-500/20',
    };
    return styles[s] || 'bg-secondary text-muted-foreground ring-1 ring-inset ring-border';
  };

  const filteredTrades = trades.filter(trade => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      trade.escrow_address.toLowerCase().includes(q) ||
      trade.merchant_pubkey.toLowerCase().includes(q) ||
      (trade.buyer_pubkey && trade.buyer_pubkey.toLowerCase().includes(q))
    );
  });

  const filteredLanes = laneOperations.filter(op => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      op.signature.toLowerCase().includes(q) ||
      op.merchantWallet.toLowerCase().includes(q) ||
      op.laneId.toString().includes(q)
    );
  });

  // Pagination derivations (after filtered* are defined)
  const totalRows =
    viewMode === 'trades' ? filteredTrades.length :
    viewMode === 'transactions' ? allTransactions.length :
    filteredLanes.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const sliceFrom = (currentPage - 1) * pageSize;
  const sliceTo = sliceFrom + pageSize;
  const paginatedTrades = filteredTrades.slice(sliceFrom, sliceTo);
  const paginatedTransactions = allTransactions.slice(sliceFrom, sliceTo);
  const paginatedLanes = filteredLanes.slice(sliceFrom, sliceTo);

  // Compact page-number list with ellipses
  const pageNumbers: (number | '…')[] = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const out: (number | '…')[] = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    if (start > 2) out.push('…');
    for (let i = start; i <= end; i++) out.push(i);
    if (end < totalPages - 1) out.push('…');
    out.push(totalPages);
    return out;
  })();

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <header className="sticky top-0 z-50 backdrop-blur-2xl bg-background/70 border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-4 h-14">
            <div className="flex items-center gap-6 shrink-0">
              <Link href="/" className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-white text-black flex items-center justify-center">
                  <BarChart3 size={14} strokeWidth={2.5} />
                </div>
                <span className="text-[15px] font-semibold tracking-tight text-foreground">BlipScan</span>
              </Link>
              <nav className="hidden md:flex items-center gap-1 text-[13px]">
                <Link href="/" className="px-3 py-1.5 rounded-full font-medium text-foreground bg-white/[0.06]">
                  Trades
                </Link>
              </nav>
            </div>
            <div className="flex-1 hidden sm:flex justify-center">
              <div className="relative group w-full max-w-xl">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/40 group-focus-within:text-foreground/80 transition-colors" />
                <input
                  type="text"
                  placeholder="Search escrow, signature, merchant, lane…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-foreground text-[13px] placeholder:text-foreground/35 focus:outline-none focus:bg-white/[0.06] focus:border-white/[0.16] transition-all"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="relative ambient-bg border-b border-white/[0.06] overflow-hidden">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-16 text-center">
          <h1 className="text-[36px] sm:text-[52px] leading-[1.02] font-semibold tracking-[-0.028em] text-shimmer">
            Every trade,<br className="sm:hidden" /> on-chain.
          </h1>
          <p className="mt-3 text-[14px] text-white/55 max-w-md mx-auto">
            Real-time index of P2P escrow trades, lanes, and Solana transactions.
          </p>

          {/* Live network pills */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] backdrop-blur">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 breathe" />
              <span className="text-[11px] text-white/55">24h Volume</span>
              <span className="text-[12px] font-semibold text-white tabular-nums">{formatVolume(String(last24h.volume * 1_000_000))}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] backdrop-blur">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 breathe" />
              <span className="text-[11px] text-white/55">24h Trades</span>
              <span className="text-[12px] font-semibold text-white tabular-nums">{last24h.count}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] backdrop-blur">
              <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 breathe" />
              <span className="text-[11px] text-white/55">Last activity</span>
              <span className="text-[12px] font-semibold text-white tabular-nums">{last24h.last ? timeAgo(last24h.last) : '—'}</span>
            </div>
          </div>
        </div>
      </div>


      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Stat cards — icon top-right, sparkline beside value */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-8 -mt-14 relative z-10">
            {[
              { icon: Activity, label: 'Total Escrows', value: stats.total_trades?.toLocaleString() ?? '0', sub: 'All time', spark: sparkData.map(b => b.count || 0), tone: 'sky' },
              { icon: DollarSign, label: 'Total Volume', value: formatVolume(stats.total_volume || '0'), sub: 'All time', spark: sparkData.map(b => b.volume || 0), tone: 'emerald' },
              { icon: Users, label: 'Merchants', value: String(stats.active_merchants ?? 0), sub: 'Active', spark: sparkData.map((_, i) => i * 0 + (i % 4) + 2), tone: 'violet' },
              { icon: Clock, label: 'Avg Settlement', value: (() => { const s = stats.avg_completion_time; if (!s || s <= 0) return '—'; if (s < 60) return `${Math.round(s)}s`; if (s < 3600) return `${Math.round(s / 60)}m`; return `${(s / 3600).toFixed(1)}h`; })(), sub: 'Mean time', spark: sparkData.map((_, i) => 5 + Math.sin(i / 2) * 2 + (i % 3)), tone: 'orange' },
              { icon: CheckCircle, label: 'Success Rate', value: successRate > 0 ? `${successRate.toFixed(1)}%` : '—', sub: 'All escrows', spark: sparkData.map((_, i) => 80 + (i % 5) * 3), tone: 'teal' },
            ].map((s) => {
              const toneMap: Record<string, { icon: string; bg: string; stroke: string }> = {
                sky:     { icon: 'text-sky-400',     bg: 'bg-sky-500/10',     stroke: '#38BDF8' },
                emerald: { icon: 'text-emerald-400', bg: 'bg-emerald-500/10', stroke: '#10B981' },
                violet:  { icon: 'text-violet-400',  bg: 'bg-violet-500/10',  stroke: '#A78BFA' },
                orange:  { icon: 'text-orange-400',  bg: 'bg-orange-500/10',  stroke: '#FB923C' },
                teal:    { icon: 'text-teal-400',    bg: 'bg-teal-500/10',    stroke: '#2DD4BF' },
              };
              const c = toneMap[s.tone];
              return (
                <div key={s.label} className="rounded-2xl glass p-4 hover-lift">
                  <div className="flex items-start justify-between">
                    <span className="text-caption text-foreground/45">{s.label}</span>
                    <div className={`w-7 h-7 rounded-lg ${c.bg} ${c.icon} flex items-center justify-center`}>
                      <s.icon size={14} strokeWidth={2.2} />
                    </div>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <p className="text-[24px] leading-none font-semibold tracking-[-0.02em] text-foreground">{s.value}</p>
                    <div className="w-[60%] -mb-1" style={{ color: c.stroke }}>
                      <Sparkline points={s.spark} />
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-foreground/40">{s.sub}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* View Toggle */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5 items-stretch sm:items-center justify-between">
          <div>
            <h2 className="text-[17px] font-semibold text-foreground tracking-[-0.01em]">
              {viewMode === 'trades' ? 'Latest Escrows' : viewMode === 'transactions' ? 'Latest Transactions' : 'Latest Lane Operations'}
            </h2>
            <p className="text-[12px] text-foreground/40 mt-0.5">Updated in real-time</p>
          </div>
          <div className="flex gap-1 p-1 glass rounded-full self-start sm:self-auto">
            {(['trades', 'transactions', 'lanes'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-all ${
                  viewMode === mode ? 'bg-foreground text-background' : 'text-foreground/55 hover:text-foreground'
                }`}
              >
                {mode === 'trades' ? 'Escrows' : mode === 'transactions' ? 'All Tx' : 'Lanes'}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-4 overflow-x-auto no-scrollbar">
          <div className="flex gap-1.5 shrink-0">
            {viewMode === 'trades' ? (
              (['all', 'funded', 'locked', 'released', 'refunded'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-3 py-1 rounded-full text-[12px] font-medium transition-all border ${
                    filter === s
                      ? 'bg-foreground text-background border-transparent'
                      : 'text-foreground/55 hover:text-foreground border-white/[0.08] hover:border-white/[0.16]'
                  }`}
                >
                  {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))
            ) : viewMode === 'transactions' ? (
              (['all', 'create_trade', 'lock_escrow', 'release_escrow', 'refund_escrow', 'create_escrow'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTxFilter(t)}
                  className={`px-3 py-1 rounded-full text-[12px] font-medium transition-all border ${
                    txFilter === t
                      ? 'bg-foreground text-background border-transparent'
                      : 'text-foreground/55 hover:text-foreground border-white/[0.08] hover:border-white/[0.16]'
                  }`}
                >
                  {t === 'all' ? 'All' : t.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}
                </button>
              ))
            ) : (
              (['all', 'CreateLane', 'FundLane', 'WithdrawLane'] as const).map((op) => (
                <button
                  key={op}
                  onClick={() => setLaneFilter(op)}
                  className={`px-3 py-1 rounded-full text-[12px] font-medium transition-all border ${
                    laneFilter === op
                      ? 'bg-foreground text-background border-transparent'
                      : 'text-foreground/55 hover:text-foreground border-white/[0.08] hover:border-white/[0.16]'
                  }`}
                >
                  {op === 'all' ? 'All' : op}
                </button>
              ))
            )}
          </div>
          <div className="flex-1" />
          <span className="text-[11px] text-foreground/40 shrink-0">
            {totalRows.toLocaleString()} results
          </span>
        </div>

        {/* Table */}
        <div className="rounded-2xl glass overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {viewMode === 'trades' ? (
                <>
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.015]">
                      <th className="text-left py-2.5 px-4 text-caption text-foreground/45">Escrow</th>
                      <th className="text-left py-2.5 px-4 text-caption text-foreground/45">Status</th>
                      <th className="text-right py-2.5 px-4 text-caption text-foreground/45">Amount</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden md:table-cell">Creator</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden lg:table-cell">Counterparty</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden sm:table-cell">Ver</th>
                      <th className="text-right py-2.5 px-4 text-caption text-foreground/45">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                            <span className="text-sm text-muted-foreground">Loading escrows...</span>
                          </div>
                        </td>
                      </tr>
                    ) : filteredTrades.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-sm text-muted-foreground">
                          No escrows found
                        </td>
                      </tr>
                    ) : (
                      paginatedTrades.map((trade) => (
                        <tr key={trade.escrow_address + trade.created_at} className={`border-b border-white/[0.05] last:border-0 hover:bg-white/[0.025] transition-colors ${flashRows.has(trade.escrow_address) ? 'row-flash' : ''}`}>
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/trade/${trade.escrow_address}`}
                                className="font-mono text-sm text-muted-foreground hover:text-foreground hover:underline"
                              >
                                {addr(trade.escrow_address, 6)}
                              </Link>
                              <button
                                onClick={() => copyToClipboard(trade.escrow_address)}
                                className="p-0.5 rounded hover:bg-secondary transition-colors"
                              >
                                {copiedAddress === trade.escrow_address ? (
                                  <CheckCircle size={12} className="text-emerald-500" />
                                ) : (
                                  <Copy size={12} className="text-muted-foreground" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-2.5 px-4">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${statusChip(trade.status)}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${statusDot(trade.status)}`} />
                              {trade.status?.toLowerCase() || 'unknown'}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <span className="text-sm font-medium text-foreground inline-flex items-center justify-end w-full">
                              <UsdtBadge>{formatAmount(trade.amount)}</UsdtBadge>
                            </span>
                          </td>
                          <td className="py-2.5 px-4 hidden md:table-cell">
                            <span className="font-mono text-xs text-muted-foreground">
                              {addr(trade.merchant_pubkey, 4)}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 hidden lg:table-cell">
                            {trade.buyer_pubkey ? (
                              <span className="font-mono text-xs text-muted-foreground">
                                {addr(trade.buyer_pubkey, 4)}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 hidden sm:table-cell">
                            <span className="text-xs text-muted-foreground font-mono">
                              {trade.protocol_version || 'v1'}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <span className="text-xs text-muted-foreground">{timeAgo(trade.created_at)}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </>
              ) : viewMode === 'transactions' ? (
                <>
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.015]">
                      <th className="text-left py-2.5 px-4 text-caption text-foreground/45">Signature</th>
                      <th className="text-left py-2.5 px-4 text-caption text-foreground/45">Instruction</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden md:table-cell">Escrow</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden sm:table-cell">Ver</th>
                      <th className="text-right py-2.5 px-4 text-caption text-foreground/45">Time</th>
                      <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="py-16 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                            <span className="text-sm text-muted-foreground">Loading transactions...</span>
                          </div>
                        </td>
                      </tr>
                    ) : allTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-16 text-center text-sm text-muted-foreground">
                          No transactions found. Indexer may still be catching up.
                        </td>
                      </tr>
                    ) : (
                      paginatedTransactions.map((tx) => {
                        const instrColor = tx.instruction_type.includes('create') || tx.instruction_type.includes('fund') ? 'text-blue-600 dark:text-blue-400' :
                          tx.instruction_type.includes('lock') || tx.instruction_type.includes('match') ? 'text-yellow-600 dark:text-yellow-400' :
                          tx.instruction_type.includes('release') ? 'text-emerald-600 dark:text-emerald-400' :
                          tx.instruction_type.includes('refund') ? 'text-red-600 dark:text-red-400' :
                          tx.instruction_type.includes('withdraw') ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground';
                        const instrLabel = tx.instruction_type.split('_').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ');
                        return (
                          <tr key={tx.signature} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.025] transition-colors">
                            <td className="py-2.5 px-4">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-sm text-muted-foreground">{addr(tx.signature, 8)}</span>
                                <button
                                  onClick={() => copyToClipboard(tx.signature)}
                                  className="p-0.5 rounded hover:bg-secondary transition-colors"
                                >
                                  {copiedAddress === tx.signature ? (
                                    <CheckCircle size={12} className="text-emerald-500" />
                                  ) : (
                                    <Copy size={12} className="text-muted-foreground" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-2.5 px-4">
                              <span className={`text-xs font-medium ${instrColor}`}>{instrLabel}</span>
                            </td>
                            <td className="py-2.5 px-4 hidden md:table-cell">
                              {tx.trade_pda ? (
                                <Link
                                  href={`/trade/${tx.trade_pda}`}
                                  className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                                >
                                  {addr(tx.trade_pda, 4)}
                                </Link>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 hidden sm:table-cell">
                              <span className="text-xs text-muted-foreground font-mono">{tx.version}</span>
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <span className="text-xs text-muted-foreground">{timeAgo(tx.block_time)}</span>
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <a
                                href={solscanTx(tx.signature)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 rounded hover:bg-secondary transition-colors inline-flex"
                              >
                                <ExternalLink size={12} className="text-muted-foreground" />
                              </a>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </>
              ) : (
                <>
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.015]">
                      <th className="text-left py-2.5 px-4 text-caption text-foreground/45">Signature</th>
                      <th className="text-left py-2.5 px-4 text-caption text-foreground/45">Operation</th>
                      <th className="text-left py-2.5 px-4 text-caption text-foreground/45">Lane</th>
                      <th className="text-right py-2.5 px-4 text-caption text-foreground/45">Amount</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden md:table-cell">Merchant</th>
                      <th className="text-right py-2.5 px-4 text-caption text-foreground/45">Age</th>
                      <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                            <span className="text-sm text-muted-foreground">Loading lane operations...</span>
                          </div>
                        </td>
                      </tr>
                    ) : filteredLanes.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-sm text-muted-foreground">
                          No lane operations found
                        </td>
                      </tr>
                    ) : (
                      paginatedLanes.map((op) => {
                        const opColor = op.operation === 'CreateLane' ? 'text-blue-600 dark:text-blue-400' :
                          op.operation === 'FundLane' ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400';
                        return (
                          <tr key={op.id} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.025] transition-colors">
                            <td className="py-2.5 px-4">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-sm text-slate-600 dark:text-slate-400">{addr(op.signature, 6)}</span>
                                <button
                                  onClick={() => copyToClipboard(op.signature)}
                                  className="p-0.5 rounded hover:bg-secondary transition-colors"
                                >
                                  {copiedAddress === op.signature ? (
                                    <CheckCircle size={12} className="text-emerald-500" />
                                  ) : (
                                    <Copy size={12} className="text-muted-foreground" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-2.5 px-4">
                              <span className={`text-xs font-medium ${opColor}`}>{op.operation}</span>
                            </td>
                            <td className="py-2.5 px-4">
                              <span className="text-sm font-mono text-foreground">#{op.laneId}</span>
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              {op.amount ? (
                                <span className="text-sm font-medium text-foreground inline-flex items-center justify-end"><UsdtBadge>{formatAmount(op.amount)}</UsdtBadge></span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 hidden md:table-cell">
                              <span className="font-mono text-xs text-muted-foreground">{addr(op.merchantWallet, 4)}</span>
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <span className="text-xs text-muted-foreground">{timeAgo(op.createdAt)}</span>
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <a
                                href={solscanTx(op.signature)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 rounded hover:bg-secondary transition-colors inline-flex"
                              >
                                <ExternalLink size={12} className="text-muted-foreground" />
                              </a>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </>
              )}
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalRows > 0 && (
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-[12px] text-foreground/55">
              <span>
                {sliceFrom + 1}–{Math.min(sliceTo, totalRows)} of {totalRows.toLocaleString()}
              </span>
              <div className="flex items-center gap-1.5">
                <label className="text-foreground/40">Rows</label>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as 20 | 50 | 100)}
                  className="bg-white/[0.04] border border-white/[0.08] rounded-md px-1.5 py-0.5 text-foreground text-[12px] focus:outline-none focus:border-white/[0.18]"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-2.5 py-1 rounded-md text-[12px] font-medium text-foreground/70 hover:text-foreground hover:bg-white/[0.04] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                Prev
              </button>
              {pageNumbers.map((n, i) =>
                n === '…' ? (
                  <span key={`e${i}`} className="px-1.5 text-foreground/40 text-[12px]">…</span>
                ) : (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`min-w-[28px] px-2 py-1 rounded-md text-[12px] font-medium transition-colors tabular-nums ${
                      n === currentPage
                        ? 'bg-foreground text-background'
                        : 'text-foreground/60 hover:text-foreground hover:bg-white/[0.04]'
                    }`}
                  >
                    {n}
                  </button>
                )
              )}
              <button
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-2.5 py-1 rounded-md text-[12px] font-medium text-foreground/70 hover:text-foreground hover:bg-white/[0.04] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-12 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-[13px]">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-7 h-7 rounded-lg bg-white text-black flex items-center justify-center">
                <BarChart3 size={14} strokeWidth={2.5} />
              </div>
              <span className="text-[15px] font-semibold tracking-tight text-foreground">BlipScan</span>
            </div>
            <p className="text-foreground/45 text-[12px] leading-relaxed">The explorer for Blip Money — Solana&apos;s P2P escrow protocol.</p>
          </div>
          <div>
            <p className="text-caption text-foreground/45 mb-3">Explore</p>
            <ul className="space-y-2 text-foreground/70">
              <li><Link href="/" className="hover:text-foreground transition-colors">Latest Escrows</Link></li>
              <li><button onClick={() => setViewMode('transactions')} className="hover:text-foreground transition-colors">Transactions</button></li>
              <li><button onClick={() => setViewMode('lanes')} className="hover:text-foreground transition-colors">Lanes</button></li>
            </ul>
          </div>
          <div>
            <p className="text-caption text-foreground/45 mb-3">Network</p>
            <ul className="space-y-2 text-foreground/70">
              <li className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${isMainnet() ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {networkLabel()}
              </li>
              <li><a href="https://solscan.io" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors inline-flex items-center gap-1">Solscan <ExternalLink size={11} /></a></li>
            </ul>
          </div>
          <div>
            <p className="text-caption text-foreground/45 mb-3">Resources</p>
            <ul className="space-y-2 text-foreground/70">
              <li><a href="https://blip.money" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors inline-flex items-center gap-1">blip.money <ExternalLink size={11} /></a></li>
              <li><a href="https://docs.blip.money" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors inline-flex items-center gap-1">Docs <ExternalLink size={11} /></a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/[0.06]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-foreground/40">
            <span>© {new Date().getFullYear()} Blip Money. All rights reserved.</span>
            <span>Built on Solana</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
