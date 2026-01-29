'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, DollarSign, Users, Clock, BarChart3, Activity,
  ChevronDown, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell
} from 'recharts';

interface AnalyticsData {
  period: string;
  summary: {
    completedTrades: number;
    pendingTrades: number;
    disputedTrades: number;
    cancelledTrades: number;
    totalVolume: number;
    totalCryptoVolume: number;
    avgOrderSize: number;
    uniqueCustomers: number;
    totalRevenue: number;
    avgCompletionMinutes: number;
  };
  charts: {
    dailyVolume: { date: string; trades: number; volume: number; revenue: number }[];
    hourlyHeatmap: number[][];
    statusBreakdown: { status: string; count: number; volume: number }[];
    paymentMethods: { method: string; count: number; volume: number }[];
  };
  topCustomers: {
    id: string;
    username: string;
    rating: number;
    totalTrades: number;
    orderCount: number;
    totalVolume: number;
  }[];
}

interface AnalyticsDashboardProps {
  merchantId: string;
}

// Colors for charts
const CHART_COLORS = {
  primary: '#10b981',
  secondary: '#06b6d4',
  tertiary: '#8b5cf6',
  warning: '#f59e0b',
  danger: '#ef4444',
};

const STATUS_COLORS: Record<string, string> = {
  completed: CHART_COLORS.primary,
  pending: CHART_COLORS.warning,
  escrowed: CHART_COLORS.tertiary,
  disputed: CHART_COLORS.danger,
  cancelled: '#6b7280',
  payment_sent: CHART_COLORS.secondary,
};

// Format currency
function formatCurrency(value: number, currency = 'AED'): string {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// Format number with K/M suffix
function formatCompact(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toString();
}

// Day names for heatmap
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function AnalyticsDashboard({ merchantId }: AnalyticsDashboardProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState('30d');
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/merchant/analytics?merchant_id=${merchantId}&period=${period}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const result = await res.json();
      if (result.success) {
        setData(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setIsLoading(false);
    }
  }, [merchantId, period]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const periods = [
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: 'all', label: 'All time' },
  ];

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-white/40">
        <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>No analytics data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-emerald-400" />
          Analytics
        </h2>
        <div className="relative">
          <button
            onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg text-sm text-white/80
                       hover:bg-white/10 transition-colors"
          >
            {periods.find(p => p.value === period)?.label}
            <ChevronDown className="w-4 h-4" />
          </button>
          {showPeriodDropdown && (
            <div className="absolute right-0 top-full mt-1 bg-zinc-800 rounded-lg shadow-xl border border-white/10 py-1 z-10">
              {periods.map(p => (
                <button
                  key={p.value}
                  onClick={() => {
                    setPeriod(p.value);
                    setShowPeriodDropdown(false);
                  }}
                  className={`w-full px-4 py-2 text-sm text-left hover:bg-white/10 transition-colors
                    ${period === p.value ? 'text-emerald-400' : 'text-white/80'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Total Volume"
          value={formatCurrency(data.summary.totalVolume)}
          trend={data.charts.dailyVolume.length > 1 ? 12.5 : undefined}
          color="emerald"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Revenue"
          value={formatCurrency(data.summary.totalRevenue)}
          subvalue="0.5% trader cut"
          color="cyan"
        />
        <StatCard
          icon={<Activity className="w-5 h-5" />}
          label="Completed Trades"
          value={data.summary.completedTrades.toString()}
          subvalue={`${data.summary.pendingTrades} pending`}
          color="purple"
        />
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Unique Customers"
          value={data.summary.uniqueCustomers.toString()}
          subvalue={`Avg ${formatCurrency(data.summary.avgOrderSize)} per trade`}
          color="amber"
        />
      </div>

      {/* Volume Chart */}
      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
        <h3 className="text-sm font-medium text-white/70 mb-4">Daily Volume</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.charts.dailyVolume}>
              <defs>
                <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey="date"
                stroke="rgba(255,255,255,0.3)"
                fontSize={12}
                tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              />
              <YAxis
                stroke="rgba(255,255,255,0.3)"
                fontSize={12}
                tickFormatter={(value) => formatCompact(value)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                }}
                labelFormatter={(value) => new Date(value).toLocaleDateString()}
                formatter={(value: number) => [formatCurrency(value), 'Volume']}
              />
              <Area
                type="monotone"
                dataKey="volume"
                stroke={CHART_COLORS.primary}
                fillOpacity={1}
                fill="url(#volumeGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Two Column Charts */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Status Breakdown */}
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <h3 className="text-sm font-medium text-white/70 mb-4">Order Status</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.charts.statusBreakdown}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                >
                  {data.charts.statusBreakdown.map((entry) => (
                    <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || '#6b7280'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number, name: string) => [value, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {data.charts.statusBreakdown.slice(0, 4).map(item => (
              <div key={item.status} className="flex items-center gap-1 text-xs text-white/60">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[item.status] || '#6b7280' }}
                />
                {item.status}: {item.count}
              </div>
            ))}
          </div>
        </div>

        {/* Payment Methods */}
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <h3 className="text-sm font-medium text-white/70 mb-4">Payment Methods</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.paymentMethods} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis type="number" stroke="rgba(255,255,255,0.3)" fontSize={12} />
                <YAxis
                  type="category"
                  dataKey="method"
                  stroke="rgba(255,255,255,0.3)"
                  fontSize={12}
                  tickFormatter={(value) => value === 'bank' ? 'Bank' : 'Cash'}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [formatCurrency(value), 'Volume']}
                />
                <Bar dataKey="volume" fill={CHART_COLORS.secondary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Activity Heatmap */}
      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
        <h3 className="text-sm font-medium text-white/70 mb-4">Activity Heatmap</h3>
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="grid grid-cols-[50px_repeat(24,1fr)] gap-1">
              {/* Header - Hours */}
              <div />
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} className="text-[10px] text-white/30 text-center">
                  {i === 0 ? '12a' : i === 12 ? '12p' : i < 12 ? `${i}a` : `${i - 12}p`}
                </div>
              ))}
              {/* Days */}
              {DAY_NAMES.map((day, dayIdx) => (
                <>
                  <div key={`label-${day}`} className="text-xs text-white/50 py-1">{day}</div>
                  {data.charts.hourlyHeatmap[dayIdx].map((count, hourIdx) => {
                    const maxCount = Math.max(...data.charts.hourlyHeatmap.flat());
                    const intensity = maxCount > 0 ? count / maxCount : 0;
                    return (
                      <div
                        key={`${dayIdx}-${hourIdx}`}
                        className="aspect-square rounded-sm"
                        style={{
                          backgroundColor: intensity > 0
                            ? `rgba(16, 185, 129, ${0.1 + intensity * 0.8})`
                            : 'rgba(255, 255, 255, 0.03)',
                        }}
                        title={`${day} ${hourIdx}:00 - ${count} orders`}
                      />
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Top Customers */}
      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
        <h3 className="text-sm font-medium text-white/70 mb-4">Top Customers</h3>
        <div className="space-y-2">
          {data.topCustomers.length === 0 ? (
            <p className="text-white/40 text-sm text-center py-4">No customer data yet</p>
          ) : (
            data.topCustomers.map((customer, idx) => (
              <div
                key={customer.id}
                className="flex items-center justify-between py-2 px-3 bg-white/5 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs
                                   flex items-center justify-center font-medium">
                    {idx + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-white">{customer.username}</p>
                    <p className="text-xs text-white/50">
                      {customer.orderCount} orders • ⭐ {customer.rating.toFixed(1)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-emerald-400">
                    {formatCurrency(customer.totalVolume)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 text-center">
          <Clock className="w-6 h-6 text-cyan-400 mx-auto mb-2" />
          <p className="text-2xl font-bold text-white">
            {Math.round(data.summary.avgCompletionMinutes)}m
          </p>
          <p className="text-xs text-white/50">Avg. Completion Time</p>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 text-center">
          <Activity className="w-6 h-6 text-purple-400 mx-auto mb-2" />
          <p className="text-2xl font-bold text-white">
            {data.summary.pendingTrades}
          </p>
          <p className="text-xs text-white/50">Pending Orders</p>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 text-center">
          <TrendingUp className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
          <p className="text-2xl font-bold text-white">
            {formatCompact(data.summary.totalCryptoVolume)}
          </p>
          <p className="text-xs text-white/50">USDC Traded</p>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 text-center">
          <Users className="w-6 h-6 text-amber-400 mx-auto mb-2" />
          <p className="text-2xl font-bold text-white">
            {data.summary.disputedTrades}
          </p>
          <p className="text-xs text-white/50">Disputes</p>
        </div>
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({
  icon,
  label,
  value,
  subvalue,
  trend,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subvalue?: string;
  trend?: number;
  color: 'emerald' | 'cyan' | 'purple' | 'amber';
}) {
  const colorClasses = {
    emerald: 'text-emerald-400 bg-emerald-500/10',
    cyan: 'text-cyan-400 bg-cyan-500/10',
    purple: 'text-purple-400 bg-purple-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
  };

  return (
    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
      <div className="flex items-center justify-between mb-2">
        <span className={`p-2 rounded-lg ${colorClasses[color]}`}>{icon}</span>
        {trend !== undefined && (
          <span className={`flex items-center text-xs ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-white/50 mt-1">{subvalue || label}</p>
    </div>
  );
}

export default AnalyticsDashboard;
