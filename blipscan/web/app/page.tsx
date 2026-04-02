'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Activity, DollarSign, Clock, CheckCircle, Copy, ChevronRight, BarChart3, Sun, Moon, Users, ExternalLink } from 'lucide-react';
import { useTradeStream } from './hooks/useTradeStream';

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

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('blipscan-theme', next ? 'dark' : 'light');
  };

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-lg hover:bg-secondary transition-colors"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <Sun size={16} className="text-muted-foreground" /> : <Moon size={16} className="text-muted-foreground" />}
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

  const fetchTrades = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/trades?status=${filter !== 'all' ? filter : ''}&limit=50`);
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

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <header className="border-b border-border sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
                  <BarChart3 size={13} className="text-white" />
                </div>
                <span className="text-sm font-semibold text-foreground">BlipScan</span>
              </Link>
              <nav className="hidden md:flex items-center gap-1">
                <Link href="/" className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground bg-secondary">
                  Trades
                </Link>
                <Link href="/merchants" className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  Merchants
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-xs text-muted-foreground">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                Devnet
              </div>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Stats Bar */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
              <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                <Activity size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground leading-tight">{stats.total_trades?.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total Trades</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center shrink-0">
                <DollarSign size={16} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground leading-tight">{formatVolume(stats.total_volume || '0')}</p>
                <p className="text-xs text-muted-foreground">Total Volume</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
              <div className="w-9 h-9 rounded-lg bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center shrink-0">
                <Users size={16} className="text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground leading-tight">{stats.active_merchants}</p>
                <p className="text-xs text-muted-foreground">Merchants</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
              <div className="w-9 h-9 rounded-lg bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center shrink-0">
                <Clock size={16} className="text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground leading-tight">
                  {stats.avg_completion_time ? `${Math.round(stats.avg_completion_time / 60)}m` : '—'}
                </p>
                <p className="text-xs text-muted-foreground">Avg Settlement</p>
              </div>
            </div>
          </div>
        )}

        {/* Search + View Toggle */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder={viewMode === 'trades' ? 'Search by escrow, merchant, or buyer address...' : 'Search by signature, lane ID, or merchant...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-card border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
            />
          </div>
          <div className="flex gap-1 p-1 bg-secondary rounded-lg">
            {(['trades', 'transactions', 'lanes'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewMode === mode ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {mode === 'trades' ? 'Escrows' : mode === 'transactions' ? 'All Tx' : 'Lanes'}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex gap-1">
            {viewMode === 'trades' ? (
              (['all', 'funded', 'locked', 'released', 'refunded'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    filter === s
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
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
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    txFilter === t
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
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
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    laneFilter === op
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                >
                  {op === 'all' ? 'All' : op}
                </button>
              ))
            )}
          </div>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {viewMode === 'trades' ? filteredTrades.length : viewMode === 'transactions' ? allTransactions.length : filteredLanes.length} results
          </span>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {viewMode === 'trades' ? (
                <>
                  <thead>
                    <tr className="border-b border-border bg-secondary/50">
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Escrow</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground">Amount</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden md:table-cell">Creator</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden lg:table-cell">Counterparty</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden sm:table-cell">Ver</th>
                      <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground">Age</th>
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
                      filteredTrades.map((trade) => (
                        <tr key={trade.escrow_address + trade.created_at} className="border-b border-border last:border-0 hover:bg-card-hover transition-colors">
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
                            <div className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${statusDot(trade.status)}`} />
                              <span className={`text-xs font-medium capitalize ${statusText(trade.status)}`}>
                                {trade.status?.toLowerCase() || 'unknown'}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <span className="font-mono text-sm font-medium text-foreground">
                              ${formatAmount(trade.amount)}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 hidden md:table-cell">
                            <Link
                              href={`/merchant/${trade.merchant_pubkey}`}
                              className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                            >
                              {addr(trade.merchant_pubkey, 4)}
                            </Link>
                          </td>
                          <td className="py-2.5 px-4 hidden lg:table-cell">
                            {trade.buyer_pubkey ? (
                              <Link
                                href={`/merchant/${trade.buyer_pubkey}`}
                                className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                              >
                                {addr(trade.buyer_pubkey, 4)}
                              </Link>
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
                    <tr className="border-b border-border bg-secondary/50">
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Signature</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Instruction</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden md:table-cell">Escrow</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden sm:table-cell">Ver</th>
                      <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground">Time</th>
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
                      allTransactions.map((tx) => {
                        const instrColor = tx.instruction_type.includes('create') || tx.instruction_type.includes('fund') ? 'text-blue-600 dark:text-blue-400' :
                          tx.instruction_type.includes('lock') || tx.instruction_type.includes('match') ? 'text-yellow-600 dark:text-yellow-400' :
                          tx.instruction_type.includes('release') ? 'text-emerald-600 dark:text-emerald-400' :
                          tx.instruction_type.includes('refund') ? 'text-red-600 dark:text-red-400' :
                          tx.instruction_type.includes('withdraw') ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground';
                        const instrLabel = tx.instruction_type.split('_').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ');
                        return (
                          <tr key={tx.signature} className="border-b border-border last:border-0 hover:bg-card-hover transition-colors">
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
                                href={`https://solscan.io/tx/${tx.signature}?cluster=devnet`}
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
                    <tr className="border-b border-border bg-secondary/50">
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Signature</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Operation</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Lane</th>
                      <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground">Amount</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground hidden md:table-cell">Merchant</th>
                      <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground">Age</th>
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
                      filteredLanes.map((op) => {
                        const opColor = op.operation === 'CreateLane' ? 'text-blue-600 dark:text-blue-400' :
                          op.operation === 'FundLane' ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400';
                        return (
                          <tr key={op.id} className="border-b border-border last:border-0 hover:bg-card-hover transition-colors">
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
                                <span className="font-mono text-sm font-medium text-foreground">${formatAmount(op.amount)}</span>
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
                                href={`https://solscan.io/tx/${op.signature}?cluster=devnet`}
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

        {/* Footer */}
        <div className="mt-4 text-center text-xs text-muted-foreground">
          Blip Money P2P Escrow Explorer &middot; Solana Devnet
        </div>
      </div>
    </div>
  );
}
