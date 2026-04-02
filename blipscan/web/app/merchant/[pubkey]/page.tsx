'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Copy, Check, ExternalLink, TrendingUp, Clock, CheckCircle2, XCircle, ChevronRight, Sun, Moon } from 'lucide-react';

interface MerchantStats {
  merchant_pubkey: string;
  total_trades: number;
  completed_trades: number;
  cancelled_trades: number;
  total_volume: string;
  completion_rate: number;
  avg_completion_time_seconds: number;
  last_trade_at: string;
}

interface Trade {
  id: string;
  escrow_address: string;
  merchant_pubkey: string;
  buyer_pubkey: string | null;
  amount: string;
  status: 'funded' | 'locked' | 'released' | 'refunded';
  created_at: string;
  released_at: string | null;
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
    <button onClick={toggle} className="p-2 rounded-lg hover:bg-secondary transition-colors" title="Toggle theme">
      {dark ? <Sun size={16} className="text-foreground" /> : <Moon size={16} className="text-foreground" />}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="p-1 rounded hover:bg-secondary transition-colors" title="Copy">
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} className="text-muted-foreground" />}
    </button>
  );
}

export default function MerchantPage({ params }: { params: { pubkey: string } }) {
  const [stats, setStats] = useState<MerchantStats | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMerchantData();
  }, [params.pubkey]);

  const fetchMerchantData = async () => {
    try {
      setLoading(true);
      const [statsRes, tradesRes] = await Promise.all([
        fetch(`/api/merchant/${params.pubkey}`),
        fetch(`/api/merchant/${params.pubkey}/trades`),
      ]);

      const statsData = await statsRes.json();
      const tradesData = await tradesRes.json();

      setStats(statsData);
      setTrades(tradesData.trades || []);
    } catch (error) {
      console.error('Error fetching merchant data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (address: string) => {
    if (!address) return '—';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const formatAmount = (amount: string) => {
    const num = parseInt(amount) / 1_000_000;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatTime = (timestamp: string | null) => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const getStatusDot = (status: string) => {
    const colors: Record<string, string> = {
      funded: 'bg-blue-500',
      locked: 'bg-yellow-500',
      released: 'bg-emerald-500',
      refunded: 'bg-red-500',
    };
    return colors[status] || 'bg-gray-400';
  };

  const solscanAccount = (addr: string) => `https://solscan.io/account/${addr}?cluster=devnet`;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const completionRate = stats?.completion_rate ?? 0;
  const avgTime = stats?.avg_completion_time_seconds ?? 0;
  const completedTrades = stats?.completed_trades ?? 0;

  // Compute reputation score client-side
  const completionPts = completionRate * 0.6;
  const volumePts = Math.min(20, Math.floor(completedTrades / 5));
  const speedPts = avgTime > 0 ? Math.max(0, 20 - (avgTime / 3600 * 0.83)) : 0;
  const reputationScore = Math.min(100, completionPts + volumePts + speedPts);

  const getReputationColor = (score: number) => {
    if (score >= 80) return 'text-emerald-600 dark:text-emerald-400';
    if (score >= 60) return 'text-yellow-600 dark:text-yellow-400';
    if (score >= 40) return 'text-orange-600 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getReputationBarColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getReputationLabel = (score: number) => {
    if (score >= 90) return 'Excellent';
    if (score >= 75) return 'Very Good';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Poor';
  };

  if (!stats || stats.total_trades === undefined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Merchant not found</p>
          <Link href="/" className="text-sm text-primary hover:underline mt-2 inline-block">
            Back to explorer
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-white font-bold text-xs">B</span>
              </div>
              <span className="font-semibold text-foreground text-sm">BlipScan</span>
            </Link>
            <div className="hidden sm:flex items-center gap-4 text-xs">
              <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">Trades</Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400">
              Devnet
            </span>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-5">
          <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
          <ChevronRight size={12} />
          <span className="text-foreground">Merchant</span>
        </div>

        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-foreground mb-2">Merchant Profile</h1>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground break-all">{params.pubkey}</span>
            <CopyButton text={params.pubkey} />
            <a href={solscanAccount(params.pubkey)} target="_blank" rel="noopener noreferrer"
              className="p-1 rounded hover:bg-secondary transition-colors">
              <ExternalLink size={12} className="text-muted-foreground" />
            </a>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={13} className="text-primary" />
              <span className="text-xs text-muted-foreground">Total Trades</span>
            </div>
            <p className="text-xl font-semibold text-foreground">{(stats.total_trades ?? 0).toLocaleString()}</p>
          </div>

          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-primary">$</span>
              <span className="text-xs text-muted-foreground">Volume</span>
            </div>
            <p className="text-xl font-semibold text-foreground">${formatAmount(stats.total_volume || '0')}</p>
          </div>

          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={13} className="text-emerald-500" />
              <span className="text-xs text-muted-foreground">Completed</span>
            </div>
            <p className="text-xl font-semibold text-foreground">{completedTrades.toLocaleString()}</p>
          </div>

          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={13} className="text-primary" />
              <span className="text-xs text-muted-foreground">Avg. Time</span>
            </div>
            <p className="text-xl font-semibold text-foreground">{avgTime > 0 ? Math.round(avgTime / 60) : 0}m</p>
          </div>
        </div>

        {/* Reputation section */}
        <div className="rounded-lg border border-border bg-card mb-4">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Reputation</h2>
          </div>
          <div className="px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-semibold ${getReputationColor(reputationScore)}`}>
                  {reputationScore.toFixed(1)}
                </span>
                <span className="text-sm text-muted-foreground">/ 100</span>
                <span className={`text-xs font-medium ml-1 ${getReputationColor(reputationScore)}`}>
                  {getReputationLabel(reputationScore)}
                </span>
              </div>
              <span className="text-sm text-foreground font-medium">{completionRate.toFixed(1)}% completion</span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 rounded-full bg-secondary mb-4">
              <div
                className={`h-full rounded-full transition-all ${getReputationBarColor(reputationScore)}`}
                style={{ width: `${Math.min(100, reputationScore)}%` }}
              />
            </div>

            {/* Breakdown */}
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div className="flex items-center justify-between p-2 rounded bg-secondary/50">
                <span className="text-muted-foreground">Completion</span>
                <span className="font-medium text-foreground">{completionPts.toFixed(1)} pts</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-secondary/50">
                <span className="text-muted-foreground">Volume</span>
                <span className="font-medium text-foreground">{volumePts.toFixed(1)} pts</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-secondary/50">
                <span className="text-muted-foreground">Speed</span>
                <span className="font-medium text-foreground">{speedPts.toFixed(1)} pts</span>
              </div>
            </div>
          </div>
        </div>

        {/* Trade breakdown */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
              <span className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">{completedTrades.toLocaleString()}</span>
            </div>
            <p className="text-xs text-emerald-600 dark:text-emerald-400/70 mt-0.5">Completed</p>
          </div>

          <div className="rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <XCircle size={14} className="text-red-600 dark:text-red-400" />
              <span className="text-lg font-semibold text-red-700 dark:text-red-400">{(stats.cancelled_trades ?? 0).toLocaleString()}</span>
            </div>
            <p className="text-xs text-red-600 dark:text-red-400/70 mt-0.5">Cancelled</p>
          </div>
        </div>

        {/* Recent Trades table */}
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Recent Trades</h2>
          </div>
          {trades.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-muted-foreground">No trades found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Escrow</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Status</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Amount</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Buyer</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr key={trade.id} className="border-b border-border/50 last:border-0 hover:bg-card-hover transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/trade/${trade.escrow_address}`} className="font-mono text-muted-foreground hover:text-foreground hover:underline">
                            {formatAddress(trade.escrow_address)}
                          </Link>
                          <CopyButton text={trade.escrow_address} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${getStatusDot(trade.status)}`} />
                          <span className="capitalize text-foreground">{trade.status}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-foreground">
                        ${formatAmount(trade.amount)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">
                        {trade.buyer_pubkey ? formatAddress(trade.buyer_pubkey) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">
                        {formatTime(trade.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
