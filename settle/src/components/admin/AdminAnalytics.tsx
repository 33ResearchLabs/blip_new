'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp, DollarSign, Users, Clock, Activity, Shield,
  AlertTriangle, BarChart3, ArrowUpRight, ArrowDownRight,
  Zap, Lock, Crown, ShoppingCart, CheckCircle, XCircle, Info,
} from 'lucide-react';
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

// ─── Types ───────────────────────────────────────────────
interface AnalyticsResponse {
  timeframe: string;
  volume: {
    total: number;
    totalFiat: number;
    orderCount: number;
    trend: { time: string; volume: number; count: number }[];
  };
  buySell: { type: string; count: number; volume: number }[];
  revenue: { total: number; fees: number; avgFee: number };
  orders: {
    total: number;
    completed: number;
    cancelled: number;
    disputed: number;
    successRate: number;
    avgSize: number;
    avgCompletionSeconds: number;
  };
  users: {
    newUsers: number;
    activeMerchants: number;
    topTraders: { name: string; emoji: string; volume: number; trades: number }[];
  };
  risk: { disputeRate: number; failedCount: number; escrowLocked: number };
  liveFeed: {
    id: string;
    orderNumber: string;
    type: string;
    amount: number;
    fiatAmount: number;
    status: string;
    createdAt: string;
    merchant: string;
  }[];
}

const TIMEFRAMES = [
  { key: '1m', label: '1m' },
  { key: '5m', label: '5m' },
  { key: '15m', label: '15m' },
  { key: '30m', label: '30m' },
  { key: '1h', label: '1h' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '1month', label: '1M' },
  { key: 'all', label: 'All' },
];

const PIE_COLORS = ['#10b981', '#ef4444'];

// ─── Helpers ─────────────────────────────────────────────
function fmt(v: number, decimals = 2): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(decimals);
}

function fmtTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatChartTime(time: string, tf: string): string {
  const d = new Date(time);
  if (['1m', '5m', '15m', '30m', '1h', '24h'].includes(tf)) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─── Tooltip ─────────────────────────────────────────────
function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-card-solid border border-border-strong rounded-lg text-[9px] text-foreground/70 whitespace-nowrap z-50 shadow-lg pointer-events-none">
          {text}
        </div>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card-solid border border-border-strong rounded-lg px-2.5 py-1.5 shadow-xl">
      <p className="text-[9px] text-foreground/50 font-mono mb-0.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-[10px] font-mono font-bold" style={{ color: p.color }}>
          {p.name}: ${typeof p.value === 'number' ? fmt(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN — single screen, no scroll
// ═══════════════════════════════════════════════════════════

export default function AdminAnalytics({ adminToken }: { adminToken: string }) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [timeframe, setTimeframe] = useState('24h');
  const [isLoading, setIsLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const tokenRef = useRef(adminToken);
  tokenRef.current = adminToken;

  const fetchAnalytics = useCallback(async (tf: string) => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const res = await fetchWithAuth(`/api/admin/analytics?timeframe=${tf}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        console.error('Analytics API error:', json.error);
      }
    } catch (err) {
      console.error('Analytics fetch error:', err);
    } finally {
      setIsLoading(false);
      setIsTransitioning(false);
    }
  }, []);

  useEffect(() => { fetchAnalytics(timeframe); }, [fetchAnalytics, timeframe]);
  useEffect(() => {
    const interval = setInterval(() => fetchAnalytics(timeframe), 30000);
    return () => clearInterval(interval);
  }, [fetchAnalytics, timeframe]);

  const handleTf = (tf: string) => {
    if (tf === timeframe) return;
    setIsTransitioning(true);
    setTimeframe(tf);
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          <span className="text-[10px] font-mono text-foreground/20 uppercase tracking-widest">Loading Analytics</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-foreground/30">
        <BarChart3 className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm">No analytics data available</p>
      </div>
    );
  }

  const buyData = data.buySell.find(b => b.type === 'buy');
  const sellData = data.buySell.find(b => b.type === 'sell');
  const pieData = [
    { name: 'Buy', value: buyData?.volume || 0 },
    { name: 'Sell', value: sellData?.volume || 0 },
  ].filter(d => d.value > 0);

  const riskColor = data.risk.disputeRate > 5 ? 'error' : data.risk.disputeRate > 2 ? 'warning' : 'success';
  const riskLabel = data.risk.disputeRate > 5 ? 'HIGH' : data.risk.disputeRate > 2 ? 'MED' : 'LOW';

  return (
    <div className={`h-full flex flex-col overflow-hidden transition-opacity duration-300 ${isTransitioning ? 'opacity-50' : 'opacity-100'}`}>

      {/* ── TOP BAR: timeframe selector ── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-section-divider shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-primary/50" />
          <span className="text-[10px] font-bold text-foreground/50 font-mono uppercase tracking-wider">Analytics</span>
        </div>
        <div className="flex items-center gap-0.5 bg-card rounded-md p-[2px] border border-border">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.key}
              onClick={() => handleTf(tf.key)}
              className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition-all duration-200 ${
                timeframe === tf.key
                  ? 'bg-primary text-foreground shadow-sm shadow-primary/20'
                  : 'text-foreground/25 hover:text-foreground/50 hover:bg-card'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── MAIN GRID — fills remaining space ── */}
      <div className="flex-1 min-h-0 grid grid-cols-4 grid-rows-[auto_1fr_1fr] gap-[3px] p-[3px]">

        {/* ═══ ROW 1: 4 stat cards ═══ */}
        <div className="glass-card rounded-lg p-2.5 border border-border flex items-center gap-2.5">
          <Tip text="Total crypto volume of completed trades">
            <span className="p-1.5 rounded-lg text-primary bg-primary/10 shrink-0">
              <DollarSign className="w-4 h-4" />
            </span>
          </Tip>
          <div className="min-w-0">
            <p className="text-[9px] text-foreground/30 font-mono uppercase">Volume</p>
            <p className="text-lg font-black font-mono tabular-nums text-foreground leading-tight">${fmt(data.volume.total)}</p>
            <p className="text-[8px] text-foreground/20 font-mono">{data.volume.orderCount} orders</p>
          </div>
        </div>

        <div className="glass-card rounded-lg p-2.5 border border-border flex items-center gap-2.5">
          <Tip text="Platform protocol fee revenue">
            <span className="p-1.5 rounded-lg text-[var(--color-success)] bg-[var(--color-success)]/10 shrink-0">
              <TrendingUp className="w-4 h-4" />
            </span>
          </Tip>
          <div className="min-w-0">
            <p className="text-[9px] text-foreground/30 font-mono uppercase">Revenue</p>
            <p className="text-lg font-black font-mono tabular-nums text-[var(--color-success)] leading-tight">${fmt(data.revenue.total, 2)}</p>
            <p className="text-[8px] text-foreground/20 font-mono">avg ${fmt(data.revenue.avgFee, 4)}/tx</p>
          </div>
        </div>

        <div className="glass-card rounded-lg p-2.5 border border-border flex items-center gap-2.5">
          <Tip text="All orders created in timeframe">
            <span className="p-1.5 rounded-lg text-[var(--color-info)] bg-[var(--color-info)]/10 shrink-0">
              <ShoppingCart className="w-4 h-4" />
            </span>
          </Tip>
          <div className="min-w-0">
            <p className="text-[9px] text-foreground/30 font-mono uppercase">Orders</p>
            <p className="text-lg font-black font-mono tabular-nums text-foreground leading-tight">{data.orders.total}</p>
            <p className="text-[8px] text-foreground/20 font-mono">{data.orders.successRate}% success</p>
          </div>
        </div>

        <div className="glass-card rounded-lg p-2.5 border border-border flex items-center gap-2.5">
          <Tip text="Average order completion time">
            <span className="p-1.5 rounded-lg text-[var(--color-warning)] bg-[var(--color-warning)]/10 shrink-0">
              <Clock className="w-4 h-4" />
            </span>
          </Tip>
          <div className="min-w-0">
            <p className="text-[9px] text-foreground/30 font-mono uppercase">Avg Time</p>
            <p className="text-lg font-black font-mono tabular-nums text-foreground leading-tight">{fmtTime(data.orders.avgCompletionSeconds)}</p>
            <p className="text-[8px] text-foreground/20 font-mono">avg ${fmt(data.orders.avgSize)}</p>
          </div>
        </div>

        {/* ═══ ROW 2: Volume Chart (2 cols) | Buy/Sell + Orders (1 col each) ═══ */}

        {/* Volume Trend — spans 2 cols */}
        <div className="col-span-2 glass-card rounded-lg border border-border flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b border-section-divider flex items-center justify-between shrink-0">
            <span className="text-[9px] font-bold text-foreground/40 font-mono uppercase tracking-wider">Volume Trend</span>
            <Tip text="Crypto volume over time"><Info className="w-3 h-3 text-foreground/15" /></Tip>
          </div>
          <div className="flex-1 min-h-0 p-2">
            {data.volume.trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.volume.trend}>
                  <defs>
                    <linearGradient id="aVolGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F97316" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" stroke="rgba(255,255,255,0.15)" fontSize={9} fontFamily="monospace" tickFormatter={(v) => formatChartTime(v, timeframe)} />
                  <YAxis stroke="rgba(255,255,255,0.15)" fontSize={9} fontFamily="monospace" tickFormatter={(v) => `$${fmt(v, 0)}`} width={45} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="volume" name="Volume" stroke="#F97316" strokeWidth={2} fillOpacity={1} fill="url(#aVolGrad)" animationDuration={500} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-[10px] text-foreground/15 font-mono">No data</div>
            )}
          </div>
        </div>

        {/* Buy vs Sell — 1 col */}
        <div className="glass-card rounded-lg border border-border flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b border-section-divider flex items-center justify-between shrink-0">
            <span className="text-[9px] font-bold text-foreground/40 font-mono uppercase tracking-wider">Buy / Sell</span>
            <Tip text="Buy vs sell volume distribution"><Info className="w-3 h-3 text-foreground/15" /></Tip>
          </div>
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-2">
            <div className="w-full max-w-[120px] aspect-square">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="40%" outerRadius="75%" paddingAngle={3} animationDuration={500}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-[9px] text-foreground/15 font-mono">No data</div>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-[#10b981]" />
                <span className="text-[9px] font-mono text-foreground/40">Buy {buyData?.count || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-[#ef4444]" />
                <span className="text-[9px] font-mono text-foreground/40">Sell {sellData?.count || 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Orders Breakdown — 1 col */}
        <div className="glass-card rounded-lg border border-border flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b border-section-divider flex items-center justify-between shrink-0">
            <span className="text-[9px] font-bold text-foreground/40 font-mono uppercase tracking-wider">Orders</span>
            <Tip text="Order completion breakdown"><Info className="w-3 h-3 text-foreground/15" /></Tip>
          </div>
          <div className="flex-1 min-h-0 p-2.5 flex flex-col justify-center space-y-2">
            {[
              { label: 'Completed', val: data.orders.completed, color: 'bg-[var(--color-success)]', text: 'text-[var(--color-success)]' },
              { label: 'Cancelled', val: data.orders.cancelled, color: 'bg-foreground/20', text: 'text-foreground/50' },
              { label: 'Disputed', val: data.orders.disputed, color: 'bg-[var(--color-error)]', text: 'text-[var(--color-error)]' },
            ].map(row => (
              <div key={row.label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[8px] font-mono text-foreground/30">{row.label}</span>
                  <span className={`text-[10px] font-mono font-bold tabular-nums ${row.text}`}>{row.val}</span>
                </div>
                <div className="w-full h-1.5 bg-card rounded-full overflow-hidden">
                  <div
                    className={`h-full ${row.color} rounded-full transition-all duration-500`}
                    style={{ width: `${data.orders.total > 0 ? (row.val / data.orders.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
            <div className="pt-1 border-t border-section-divider flex items-center justify-between">
              <span className="text-[8px] font-mono text-foreground/20">Success Rate</span>
              <span className={`text-[11px] font-mono font-black tabular-nums ${
                data.orders.successRate >= 90 ? 'text-[var(--color-success)]' :
                data.orders.successRate >= 70 ? 'text-primary' : 'text-[var(--color-error)]'
              }`}>{data.orders.successRate}%</span>
            </div>
          </div>
        </div>

        {/* ═══ ROW 3: Revenue & Fees | User Activity + Top Traders | Risk | Live Feed ═══ */}

        {/* Revenue & Fees */}
        <div className="glass-card rounded-lg border border-border flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b border-section-divider flex items-center justify-between shrink-0">
            <span className="text-[9px] font-bold text-foreground/40 font-mono uppercase tracking-wider">Revenue</span>
            <Tip text="Protocol fees & merchant fees"><Info className="w-3 h-3 text-foreground/15" /></Tip>
          </div>
          <div className="flex-1 min-h-0 p-2.5 flex flex-col justify-center space-y-2.5">
            <div className="text-center">
              <p className="text-[8px] font-mono text-foreground/25 uppercase">Protocol Rev</p>
              <p className="text-xl font-black font-mono tabular-nums text-[var(--color-success)] leading-tight">${fmt(data.revenue.total, 2)}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center glass-card rounded p-1.5 border border-border">
                <p className="text-[7px] font-mono text-foreground/20 uppercase">Fees</p>
                <p className="text-sm font-bold font-mono tabular-nums text-primary">${fmt(data.revenue.fees, 2)}</p>
              </div>
              <div className="text-center glass-card rounded p-1.5 border border-border">
                <p className="text-[7px] font-mono text-foreground/20 uppercase">Avg/TX</p>
                <p className="text-sm font-bold font-mono tabular-nums text-foreground/60">${fmt(data.revenue.avgFee, 4)}</p>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[7px] font-mono text-foreground/20">Revenue</span>
                <span className="text-[7px] font-mono text-foreground/20">Fees</span>
              </div>
              <div className="w-full h-1.5 bg-card rounded-full overflow-hidden flex">
                <div className="h-full bg-[var(--color-success)] transition-all duration-500"
                  style={{ width: `${(data.revenue.total / Math.max(data.revenue.total + data.revenue.fees, 0.01)) * 100}%` }} />
                <div className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${(data.revenue.fees / Math.max(data.revenue.total + data.revenue.fees, 0.01)) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* User Activity */}
        <div className="glass-card rounded-lg border border-border flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b border-section-divider flex items-center justify-between shrink-0">
            <span className="text-[9px] font-bold text-foreground/40 font-mono uppercase tracking-wider">Users</span>
            <Tip text="New users & active merchants"><Info className="w-3 h-3 text-foreground/15" /></Tip>
          </div>
          <div className="flex-1 min-h-0 p-2 flex flex-col">
            <div className="grid grid-cols-2 gap-1.5 mb-2 shrink-0">
              <div className="glass-card rounded p-1.5 border border-border text-center">
                <Users className="w-3 h-3 text-primary/40 mx-auto mb-0.5" />
                <p className="text-sm font-black font-mono tabular-nums text-foreground">{data.users.newUsers}</p>
                <p className="text-[7px] text-foreground/20 font-mono">New Users</p>
              </div>
              <div className="glass-card rounded p-1.5 border border-border text-center">
                <Crown className="w-3 h-3 text-primary/40 mx-auto mb-0.5" />
                <p className="text-sm font-black font-mono tabular-nums text-foreground">{data.users.activeMerchants}</p>
                <p className="text-[7px] text-foreground/20 font-mono">Merchants</p>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-0.5">
              <p className="text-[7px] font-mono text-foreground/20 uppercase tracking-wider">Top Traders</p>
              {data.users.topTraders.length > 0 ? data.users.topTraders.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-card transition-colors">
                  <span className={`text-[9px] font-mono font-bold shrink-0 w-3 text-right ${
                    i === 0 ? 'text-primary' : 'text-foreground/25'
                  }`}>{i + 1}</span>
                  <span className="text-[11px] shrink-0">{t.emoji}</span>
                  <span className="text-[9px] font-mono text-foreground/50 truncate flex-1">{t.name}</span>
                  <span className="text-[9px] font-mono font-bold text-primary tabular-nums shrink-0">${fmt(t.volume)}</span>
                </div>
              )) : (
                <p className="text-[9px] text-foreground/15 font-mono text-center py-2">No activity</p>
              )}
            </div>
          </div>
        </div>

        {/* Risk Metrics */}
        <div className="glass-card rounded-lg border border-border flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b border-section-divider flex items-center justify-between shrink-0">
            <span className="text-[9px] font-bold text-foreground/40 font-mono uppercase tracking-wider">Risk</span>
            <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded ${
              riskColor === 'error' ? 'bg-[var(--color-error)]/10 text-[var(--color-error)]' :
              riskColor === 'warning' ? 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]' :
              'bg-[var(--color-success)]/10 text-[var(--color-success)]'
            }`}>{riskLabel}</span>
          </div>
          <div className="flex-1 min-h-0 p-2.5 flex flex-col justify-center space-y-2.5">
            <div className="text-center">
              <p className="text-[8px] font-mono text-foreground/25 uppercase">Dispute Rate</p>
              <p className={`text-2xl font-black font-mono tabular-nums leading-tight ${
                riskColor === 'error' ? 'text-[var(--color-error)]' :
                riskColor === 'warning' ? 'text-[var(--color-warning)]' :
                'text-[var(--color-success)]'
              }`}>{data.risk.disputeRate}%</p>
            </div>
            <div className="w-full h-1.5 bg-card rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-700 ${
                riskColor === 'error' ? 'bg-[var(--color-error)]' :
                riskColor === 'warning' ? 'bg-[var(--color-warning)]' :
                'bg-[var(--color-success)]'
              }`} style={{ width: `${Math.min(data.risk.disputeRate * 10, 100)}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="text-center glass-card rounded p-1.5 border border-border">
                <XCircle className="w-3 h-3 text-foreground/20 mx-auto mb-0.5" />
                <p className="text-sm font-bold font-mono tabular-nums text-foreground/60">{data.risk.failedCount}</p>
                <p className="text-[7px] text-foreground/20 font-mono">Failed</p>
              </div>
              <div className="text-center glass-card rounded p-1.5 border border-border">
                <Lock className="w-3 h-3 text-primary/40 mx-auto mb-0.5" />
                <p className="text-sm font-bold font-mono tabular-nums text-primary">${fmt(data.risk.escrowLocked)}</p>
                <p className="text-[7px] text-foreground/20 font-mono">Escrow</p>
              </div>
            </div>
          </div>
        </div>

        {/* Live Activity Feed */}
        <div className="glass-card rounded-lg border border-border flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b border-section-divider flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]/60 animate-pulse" />
              <span className="text-[9px] font-bold text-foreground/40 font-mono uppercase tracking-wider">Live Feed</span>
            </div>
            <Tip text="Latest trades in real-time"><Info className="w-3 h-3 text-foreground/15" /></Tip>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
            {data.liveFeed.length > 0 ? data.liveFeed.map((trade) => (
              <div key={trade.id} className="flex items-center gap-2 px-2.5 py-1.5 border-b border-card hover:bg-card transition-colors">
                <div className={`w-4 h-4 rounded flex items-center justify-center text-[7px] font-black shrink-0 ${
                  trade.type === 'buy'
                    ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                    : 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
                }`}>
                  {trade.type === 'buy' ? 'B' : 'S'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-mono text-foreground/50 truncate">{trade.orderNumber}</span>
                    <span className={`text-[6px] font-bold px-0.5 rounded ${
                      trade.status === 'completed' ? 'text-[var(--color-success)]' :
                      trade.status === 'disputed' ? 'text-[var(--color-error)]' :
                      'text-primary'
                    }`}>{trade.status === 'completed' ? 'DONE' : trade.status === 'payment_sent' ? 'PAID' : trade.status.toUpperCase()}</span>
                  </div>
                  <p className="text-[7px] font-mono text-foreground/20 truncate">{trade.merchant}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] font-bold font-mono tabular-nums text-foreground/70">${fmt(trade.amount)}</p>
                  <p className="text-[7px] font-mono text-foreground/15">{timeAgo(trade.createdAt)}</p>
                </div>
              </div>
            )) : (
              <div className="flex items-center justify-center h-full text-[9px] text-foreground/15 font-mono">No trades</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
