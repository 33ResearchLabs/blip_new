'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Copy, Check, ExternalLink, TrendingUp, Clock, CheckCircle2, XCircle, ChevronRight, Sun, Moon } from 'lucide-react';

interface ReputationData {
  total_score: number;
  tier: string;
  badges: string[];
  breakdown: {
    reliability: { raw: number; weighted: number; weight: number };
    volume: { raw: number; weighted: number; weight: number };
    speed: { raw: number; weighted: number; weight: number };
    liquidity: { raw: number; weighted: number; weight: number };
    trust: { raw: number; weighted: number; weight: number };
  };
  penalties: { type: string; points: number; count: number }[];
  abuse_flags: string[];
  wash_trading_detected: boolean;
  trade_count: number;
  cold_start: boolean;
}

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
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMerchantData();
  }, [params.pubkey]);

  const fetchMerchantData = async () => {
    try {
      setLoading(true);
      const [statsRes, tradesRes, repRes] = await Promise.all([
        fetch(`/api/merchant/${params.pubkey}`),
        fetch(`/api/merchant/${params.pubkey}/trades`),
        fetch(`/api/reputation/${params.pubkey}`),
      ]);

      const statsData = await statsRes.json();
      const tradesData = await tradesRes.json();
      const repData = await repRes.json();

      setStats(statsData);
      setTrades(tradesData.trades || []);
      if (!repData.error) setReputation(repData);
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

  const completedTrades = parseInt(String(stats?.completed_trades ?? 0));

  // Use server-side reputation (0-1000 scale) or fallback
  const reputationScore = reputation?.total_score ?? 0;
  const reputationTier = reputation?.tier ?? 'newcomer';

  const getReputationColor = (score: number) => {
    if (score >= 900) return 'text-cyan-500 dark:text-cyan-400';
    if (score >= 800) return 'text-blue-500 dark:text-blue-300';
    if (score >= 600) return 'text-yellow-500 dark:text-yellow-400';
    if (score >= 400) return 'text-gray-500 dark:text-gray-400';
    if (score >= 200) return 'text-orange-600 dark:text-orange-400';
    return 'text-white/30';
  };

  const getReputationBarColor = (score: number) => {
    if (score >= 900) return 'bg-cyan-400';
    if (score >= 800) return 'bg-blue-400';
    if (score >= 600) return 'bg-yellow-500';
    if (score >= 400) return 'bg-gray-400';
    if (score >= 200) return 'bg-orange-500';
    return 'bg-white/20';
  };

  const tierLabels: Record<string, string> = {
    diamond: 'Diamond',
    platinum: 'Platinum',
    gold: 'Gold',
    silver: 'Silver',
    bronze: 'Bronze',
    newcomer: 'Newcomer',
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
              <span className="text-xs text-muted-foreground">Trades</span>
            </div>
            <p className="text-xl font-semibold text-foreground">{reputation?.trade_count ?? (stats?.total_trades ?? 0)}</p>
          </div>
        </div>

        {/* Reputation section — Credit Score Gauge */}
        <div className="rounded-lg border border-border bg-card mb-4">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Reputation Score</h2>
            <div className="flex items-center gap-2">
              {reputation?.cold_start && (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400">
                  Provisional
                </span>
              )}
              {reputation?.badges.map(badge => (
                <span key={badge} className="px-2 py-0.5 rounded text-[10px] font-medium bg-secondary text-muted-foreground">
                  {badge.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
          <div className="px-4 py-6">
            {/* Gauge Meter */}
            <div className="flex flex-col items-center">
              <div className="relative" style={{ width: 440, height: 250 }}>
                <svg viewBox="0 0 440 250" className="w-full h-full" overflow="visible">
                  {/* Gauge arc segments */}
                  {(() => {
                    const segments = [
                      { start: 0, end: 20, color: '#ef4444', label: 'Poor', labelOffset: 30 },
                      { start: 20, end: 40, color: '#f97316', label: 'Fair', labelOffset: 24 },
                      { start: 40, end: 60, color: '#eab308', label: 'Good', labelOffset: 24 },
                      { start: 60, end: 80, color: '#22c55e', label: 'V.Good', labelOffset: 28 },
                      { start: 80, end: 100, color: '#06b6d4', label: 'Excellent', labelOffset: 42 },
                    ];
                    const cx = 220, cy = 210, r = 150;
                    return segments.map((seg, i) => {
                      const startAngle = Math.PI + (seg.start / 100) * Math.PI;
                      const endAngle = Math.PI + (seg.end / 100) * Math.PI;
                      const x1 = cx + r * Math.cos(startAngle);
                      const y1 = cy + r * Math.sin(startAngle);
                      const x2 = cx + r * Math.cos(endAngle);
                      const y2 = cy + r * Math.sin(endAngle);
                      const largeArc = seg.end - seg.start > 50 ? 1 : 0;
                      // Label outside the arc
                      const midAngle = Math.PI + ((seg.start + seg.end) / 200) * Math.PI;
                      const lx = cx + (r + seg.labelOffset) * Math.cos(midAngle);
                      const ly = cy + (r + seg.labelOffset) * Math.sin(midAngle);
                      return (
                        <g key={i}>
                          <path
                            d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
                            fill="none"
                            stroke={seg.color}
                            strokeWidth="28"
                            strokeLinecap="butt"
                            opacity={0.9}
                          />
                          <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                            fontSize="11" fontWeight="600" fill={seg.color} opacity={0.85}>
                            {seg.label}
                          </text>
                        </g>
                      );
                    });
                  })()}

                  {/* Needle — triangular with drop shadow */}
                  {(() => {
                    const cx = 220, cy = 210;
                    const pct = Math.min(100, Math.max(0, reputationScore / 10));
                    const angle = Math.PI + (pct / 100) * Math.PI;
                    const needleLen = 115;
                    // Tip of the needle
                    const tipX = cx + needleLen * Math.cos(angle);
                    const tipY = cy + needleLen * Math.sin(angle);
                    // Base width (perpendicular to needle direction)
                    const baseWidth = 8;
                    const perpAngle = angle + Math.PI / 2;
                    const b1x = cx + baseWidth * Math.cos(perpAngle);
                    const b1y = cy + baseWidth * Math.sin(perpAngle);
                    const b2x = cx - baseWidth * Math.cos(perpAngle);
                    const b2y = cy - baseWidth * Math.sin(perpAngle);
                    // Tail (short stub behind center)
                    const tailLen = 22;
                    const tailX = cx - tailLen * Math.cos(angle);
                    const tailY = cy - tailLen * Math.sin(angle);
                    return (
                      <g>
                        <defs>
                          <filter id="needleShadow" x="-20%" y="-20%" width="140%" height="140%">
                            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.3" />
                          </filter>
                        </defs>
                        {/* Needle body */}
                        <polygon
                          points={`${tipX},${tipY} ${b1x},${b1y} ${tailX},${tailY} ${b2x},${b2y}`}
                          className="fill-foreground"
                          filter="url(#needleShadow)"
                          opacity={0.9}
                        />
                        {/* Center hub — outer ring */}
                        <circle cx={cx} cy={cy} r="14" className="fill-foreground" filter="url(#needleShadow)" />
                        {/* Center hub — inner dot */}
                        <circle cx={cx} cy={cy} r="7" className="fill-card" />
                        {/* Center hub — tiny accent */}
                        <circle cx={cx} cy={cy} r="3" className="fill-muted-foreground" opacity={0.5} />
                      </g>
                    );
                  })()}

                  {/* Scale labels */}
                  <text x="68" y="230" fontSize="11" textAnchor="middle" className="fill-muted-foreground font-mono">0</text>
                  <text x="372" y="230" fontSize="11" textAnchor="middle" className="fill-muted-foreground font-mono">1000</text>
                </svg>
              </div>

              {/* Score below gauge */}
              <div className="flex flex-col items-center -mt-4">
                <span className={`text-5xl font-bold ${getReputationColor(reputationScore)}`}>
                  {reputationScore}
                </span>
                <span className={`text-sm font-semibold mt-1 ${getReputationColor(reputationScore)}`}>
                  {tierLabels[reputationTier] || reputationTier}
                </span>
              </div>
            </div>

            {/* 5-component breakdown */}
            <div className="grid grid-cols-5 gap-2 text-xs mt-6">
              {reputation?.breakdown ? (
                Object.entries(reputation.breakdown).map(([key, val]) => (
                  <div key={key} className="flex flex-col items-center p-2 rounded bg-secondary/50">
                    <span className="text-muted-foreground capitalize mb-1">{key}</span>
                    <span className="font-semibold text-foreground text-sm">{val.raw}</span>
                    <span className="text-[10px] text-muted-foreground">{val.weight}%</span>
                  </div>
                ))
              ) : (
                <div className="col-span-5 text-center text-muted-foreground py-2">Loading breakdown...</div>
              )}
            </div>

            {/* Penalties */}
            {reputation?.penalties && reputation.penalties.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Penalties Applied</p>
                <div className="flex flex-wrap gap-2">
                  {reputation.penalties.map((p, i) => (
                    <span key={i} className="px-2 py-0.5 rounded text-[10px] bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">
                      {p.type.replace(/_/g, ' ')} ({p.points} pts x{p.count})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Abuse flags */}
            {reputation?.wash_trading_detected && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-[10px] text-red-600 dark:text-red-400 uppercase tracking-wider mb-1">Abuse Flags</p>
                {reputation.abuse_flags.map((flag, i) => (
                  <p key={i} className="text-xs text-red-500">{flag}</p>
                ))}
              </div>
            )}
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
