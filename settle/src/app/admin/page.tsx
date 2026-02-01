"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import {
  Activity,
  TrendingUp,
  Users,
  Clock,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  X,
  MoreHorizontal,
  RefreshCw,
  Eye,
  Settings,
  ChevronRight,
  Zap,
  DollarSign,
  Lock,
  AlertCircle,
  Star,
  Crown,
  Search,
  Command,
  Globe,
  Server,
  Cpu,
  HardDrive,
  Wifi,
  ShieldCheck,
  ShieldAlert,
  Bell,
  Sparkles,
  Layers,
  Database,
  GitBranch,
  Terminal,
  Radio,
  Gauge,
  Target,
  Fingerprint,
  Scan,
  Network,
  AreaChart,
  PieChart,
  LineChart,
  TrendingDown,
  Wallet,
  CreditCard,
  Building2,
  MapPin,
  ArrowRight,
  ChevronDown,
  Filter,
  Download,
  Share2,
  Maximize2,
  Volume2,
  Moon,
  Sun,
  Palette,
  Grid3X3,
  LayoutDashboard,
  Boxes,
  CircleDot,
  Flame,
  Rocket,
  Award,
  BadgeCheck,
} from "lucide-react";
import Link from "next/link";
import { usePusher } from "@/context/PusherContext";
import { useSounds } from "@/hooks/useSounds";

// ============================================
// TYPES & INTERFACES
// ============================================

type WidgetType =
  | "total-trades"
  | "open-orders"
  | "volume-24h"
  | "active-merchants"
  | "escrow-locked"
  | "disputes"
  | "success-rate"
  | "avg-time"
  | "revenue"
  | "users-online"
  | "top-merchants"
  | "recent-activity"
  | "live-orders"
  | "big-transactions"
  | "system-health"
  | "security-alerts"
  | "revenue-chart"
  | "user-growth"
  | "global-activity"
  | "network-status"
  | "compliance"
  | "ai-insights"
  | "tx-per-minute"
  | "tx-per-hour"
  | "today-revenue"
  | "hourly-chart";

type WidgetSize = "sm" | "md" | "lg" | "xl";

interface Widget {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  visible: boolean;
}

interface WidgetConfig {
  title: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  premium?: boolean;
}

interface StatsData {
  totalTrades: number;
  totalTradesChange: number;
  openOrders: number;
  volume24h: number;
  volume24hChange: number;
  activeMerchants: number;
  escrowLocked: number;
  disputes: number;
  successRate: number;
  avgTime: number;
  revenue: number;
  totalUsers: number;
  totalMerchants: number;
  // New real-time metrics
  txPerMinute: number;
  txPerHour: number;
  todayRevenue: number;
  peakHour: { hour: number; count: number } | null;
  hourlyData: { hour: string; count: number; volume: number }[];
}

interface ApiOrder {
  id: string;
  orderNumber: string;
  user: string;
  merchant: string;
  amount: number;
  fiatAmount: number;
  status: string;
  type: string;
  createdAt: string;
  expiresAt: string;
}

interface ApiMerchant {
  id: string;
  name: string;
  emoji: string;
  isOnline: boolean;
  rating: number;
  trades: number;
  volume: number;
}

interface ApiActivity {
  id: string;
  type: string;
  message: string;
  status: string;
  time: string;
}

// ============================================
// WIDGET CONFIGURATIONS
// ============================================

const widgetConfigs: Record<WidgetType, WidgetConfig> = {
  "total-trades": { title: "Total Trades", icon: <Activity className="w-4 h-4" />, color: "emerald", description: "All-time completed trades" },
  "open-orders": { title: "Open Orders", icon: <Clock className="w-4 h-4" />, color: "amber", description: "Currently pending orders" },
  "volume-24h": { title: "24h Volume", icon: <TrendingUp className="w-4 h-4" />, color: "blue", description: "Trading volume in last 24h" },
  "active-merchants": { title: "Active Merchants", icon: <Users className="w-4 h-4" />, color: "purple", description: "Online merchants now" },
  "escrow-locked": { title: "Escrow Locked", icon: <Lock className="w-4 h-4" />, color: "amber", description: "Funds currently in escrow" },
  "disputes": { title: "Active Disputes", icon: <AlertTriangle className="w-4 h-4" />, color: "red", description: "Open dispute cases" },
  "success-rate": { title: "Success Rate", icon: <CheckCircle className="w-4 h-4" />, color: "emerald", description: "Trade completion rate" },
  "avg-time": { title: "Avg Completion", icon: <Zap className="w-4 h-4" />, color: "purple", description: "Average trade time" },
  "revenue": { title: "Platform Revenue", icon: <DollarSign className="w-4 h-4" />, color: "emerald", description: "Total platform fees" },
  "users-online": { title: "Total Users", icon: <Eye className="w-4 h-4" />, color: "blue", description: "Registered users" },
  "top-merchants": { title: "Top Merchants", icon: <Crown className="w-4 h-4" />, color: "amber", description: "Highest volume merchants" },
  "recent-activity": { title: "Recent Activity", icon: <Activity className="w-4 h-4" />, color: "white", description: "Latest platform events" },
  "live-orders": { title: "Live Orders", icon: <Clock className="w-4 h-4" />, color: "blue", description: "Real-time order feed" },
  "big-transactions": { title: "Big Transactions", icon: <Zap className="w-4 h-4" />, color: "purple", description: "High-value trades ($5k+)" },
  "system-health": { title: "System Health", icon: <Server className="w-4 h-4" />, color: "cyan", description: "Infrastructure status", premium: true },
  "security-alerts": { title: "Security Center", icon: <ShieldAlert className="w-4 h-4" />, color: "red", description: "Threat monitoring", premium: true },
  "revenue-chart": { title: "Revenue Analytics", icon: <AreaChart className="w-4 h-4" />, color: "emerald", description: "Revenue over time", premium: true },
  "user-growth": { title: "User Growth", icon: <TrendingUp className="w-4 h-4" />, color: "blue", description: "Growth metrics", premium: true },
  "global-activity": { title: "Global Activity", icon: <Globe className="w-4 h-4" />, color: "cyan", description: "Worldwide transactions", premium: true },
  "network-status": { title: "Network Status", icon: <Network className="w-4 h-4" />, color: "purple", description: "Blockchain connectivity", premium: true },
  "compliance": { title: "Compliance", icon: <BadgeCheck className="w-4 h-4" />, color: "emerald", description: "Regulatory status", premium: true },
  "ai-insights": { title: "AI Insights", icon: <Sparkles className="w-4 h-4" />, color: "violet", description: "ML-powered analytics", premium: true },
  "tx-per-minute": { title: "TX/Minute", icon: <Gauge className="w-4 h-4" />, color: "cyan", description: "Real-time transaction rate" },
  "tx-per-hour": { title: "TX/Hour", icon: <Activity className="w-4 h-4" />, color: "blue", description: "Hourly transaction count" },
  "today-revenue": { title: "Today's Revenue", icon: <DollarSign className="w-4 h-4" />, color: "emerald", description: "Revenue earned today" },
  "hourly-chart": { title: "Hourly Activity", icon: <BarChart3 className="w-4 h-4" />, color: "purple", description: "24h transaction chart" },
};

const initialWidgets: Widget[] = [
  { id: "w1", type: "total-trades", size: "sm", visible: true },
  { id: "w2", type: "open-orders", size: "sm", visible: true },
  { id: "w3", type: "volume-24h", size: "sm", visible: true },
  { id: "w4", type: "active-merchants", size: "sm", visible: true },
  { id: "w19", type: "tx-per-minute", size: "sm", visible: true },
  { id: "w20", type: "today-revenue", size: "sm", visible: true },
  { id: "w21", type: "hourly-chart", size: "lg", visible: true },
  { id: "w15", type: "system-health", size: "lg", visible: true },
  { id: "w16", type: "revenue-chart", size: "lg", visible: true },
  { id: "w7", type: "live-orders", size: "lg", visible: true },
  { id: "w8", type: "big-transactions", size: "lg", visible: true },
  { id: "w17", type: "security-alerts", size: "lg", visible: true },
  { id: "w18", type: "global-activity", size: "lg", visible: true },
  { id: "w9", type: "top-merchants", size: "lg", visible: true },
  { id: "w10", type: "recent-activity", size: "lg", visible: true },
];

// ============================================
// UTILITY FUNCTIONS
// ============================================

const getColorClasses = (color: string) => {
  const colors: Record<string, { bg: string; border: string; text: string; icon: string; glow: string }> = {
    emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", icon: "text-emerald-400", glow: "shadow-emerald-500/20" },
    amber: { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400", icon: "text-amber-400", glow: "shadow-amber-500/20" },
    blue: { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400", icon: "text-blue-400", glow: "shadow-blue-500/20" },
    purple: { bg: "bg-purple-500/10", border: "border-purple-500/20", text: "text-purple-400", icon: "text-purple-400", glow: "shadow-purple-500/20" },
    red: { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-400", icon: "text-red-400", glow: "shadow-red-500/20" },
    cyan: { bg: "bg-cyan-500/10", border: "border-cyan-500/20", text: "text-cyan-400", icon: "text-cyan-400", glow: "shadow-cyan-500/20" },
    violet: { bg: "bg-violet-500/10", border: "border-violet-500/20", text: "text-violet-400", icon: "text-violet-400", glow: "shadow-violet-500/20" },
    white: { bg: "bg-white/[0.04]", border: "border-white/[0.08]", text: "text-gray-300", icon: "text-gray-400", glow: "shadow-white/10" },
  };
  return colors[color] || colors.white;
};

const getUserEmoji = (name: string): string => {
  const emojis = ["🦊", "🦧", "🐋", "🦄", "🔥", "💎", "🐺", "🦁", "🐯", "🐻"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return emojis[Math.abs(hash) % emojis.length];
};

// ============================================
// ANIMATED COUNTER COMPONENT
// ============================================

function AnimatedCounter({ value, duration = 1 }: { value: number; duration?: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest).toLocaleString());
  const [displayValue, setDisplayValue] = useState("0");

  useEffect(() => {
    const controls = animate(count, value, { duration });
    const unsubscribe = rounded.on("change", (v) => setDisplayValue(v));
    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [value, count, rounded, duration]);

  return <span>{displayValue}</span>;
}

// ============================================
// CIRCULAR PROGRESS COMPONENT
// ============================================

function CircularProgress({ value, size = 60, strokeWidth = 4, color = "emerald" }: { value: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  const colorMap: Record<string, string> = {
    emerald: "#10b981",
    amber: "#f59e0b",
    blue: "#3b82f6",
    purple: "#a855f7",
    red: "#ef4444",
    cyan: "#06b6d4",
  };

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.1)" strokeWidth={strokeWidth} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colorMap[color] || colorMap.emerald}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          style={{ strokeDasharray: circumference }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold">{value}%</span>
      </div>
    </div>
  );
}

// ============================================
// SPARKLINE CHART COMPONENT
// ============================================

function SparklineChart({ data, color = "emerald", height = 40 }: { data: number[]; color?: string; height?: number }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const colorMap: Record<string, string> = {
    emerald: "#10b981",
    amber: "#f59e0b",
    blue: "#3b82f6",
    purple: "#a855f7",
    red: "#ef4444",
    cyan: "#06b6d4",
  };

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = height - ((v - min) / range) * (height - 4);
    return `${x},${y}`;
  }).join(" ");

  const areaPoints = `0,${height} ${points} 100,${height}`;

  return (
    <svg viewBox={`0 0 100 ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`gradient-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colorMap[color]} stopOpacity="0.3" />
          <stop offset="100%" stopColor={colorMap[color]} stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.polygon
        points={areaPoints}
        fill={`url(#gradient-${color})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      />
      <motion.polyline
        points={points}
        fill="none"
        stroke={colorMap[color]}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.5, ease: "easeOut" }}
      />
    </svg>
  );
}

// ============================================
// MINI BAR CHART COMPONENT
// ============================================

function MiniBarChart({ data, color = "emerald" }: { data: number[]; color?: string }) {
  const max = Math.max(...data);
  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    blue: "bg-blue-500",
    purple: "bg-purple-500",
    cyan: "bg-cyan-500",
  };

  return (
    <div className="flex items-end gap-0.5 h-8">
      {data.map((v, i) => (
        <motion.div
          key={i}
          className={`w-1.5 rounded-full ${colorMap[color]} opacity-60`}
          initial={{ height: 0 }}
          animate={{ height: `${(v / max) * 100}%` }}
          transition={{ delay: i * 0.05, duration: 0.3 }}
        />
      ))}
    </div>
  );
}

// ============================================
// PULSE DOT COMPONENT
// ============================================

function PulseDot({ color = "emerald", size = "sm" }: { color?: string; size?: "sm" | "md" | "lg" }) {
  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    blue: "bg-blue-500",
    red: "bg-red-500",
    cyan: "bg-cyan-500",
  };
  const sizeMap = { sm: "w-2 h-2", md: "w-3 h-3", lg: "w-4 h-4" };

  return (
    <span className="relative flex">
      <motion.span
        className={`absolute inline-flex h-full w-full rounded-full ${colorMap[color]} opacity-75`}
        animate={{ scale: [1, 1.5, 1], opacity: [0.75, 0, 0.75] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <span className={`relative inline-flex rounded-full ${sizeMap[size]} ${colorMap[color]}`} />
    </span>
  );
}

// ============================================
// STAT WIDGET COMPONENT
// ============================================

function StatWidget({ widget, stats, onRemove }: { widget: Widget; stats: StatsData | null; onRemove: () => void }) {
  const config = widgetConfigs[widget.type];
  const colors = getColorClasses(config.color);
  const [showMenu, setShowMenu] = useState(false);

  const getValue = () => {
    if (!stats) return "—";
    switch (widget.type) {
      case "total-trades": return stats.totalTrades;
      case "open-orders": return stats.openOrders;
      case "volume-24h": return stats.volume24h >= 1000000 ? `$${(stats.volume24h / 1000000).toFixed(2)}M` : `$${(stats.volume24h / 1000).toFixed(1)}k`;
      case "active-merchants": return stats.activeMerchants;
      case "escrow-locked": return `$${(stats.escrowLocked / 1000).toFixed(1)}k`;
      case "disputes": return stats.disputes;
      case "success-rate": return `${stats.successRate.toFixed(1)}%`;
      case "avg-time": return `${stats.avgTime.toFixed(1)}m`;
      case "revenue": return `$${(stats.revenue / 1000).toFixed(1)}k`;
      case "users-online": return stats.totalUsers;
      case "tx-per-minute": return stats.txPerMinute?.toFixed(2) || "0";
      case "tx-per-hour": return stats.txPerHour || 0;
      case "today-revenue": return `$${(stats.todayRevenue || 0).toFixed(2)}`;
      default: return "—";
    }
  };

  const getChange = () => {
    if (!stats) return 0;
    switch (widget.type) {
      case "total-trades": return stats.totalTradesChange;
      case "volume-24h": return stats.volume24hChange;
      default: return Math.random() * 10 - 5;
    }
  };

  const change = getChange();
  const isPositive = change > 0;
  const invertedMetrics = ["disputes", "avg-time"];
  const isGood = invertedMetrics.includes(widget.type) ? !isPositive : isPositive;

  // Sample sparkline data
  const sparklineData = [20, 25, 30, 22, 35, 40, 38, 45, 50, 48, 55, 60];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -20 }}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={`relative group bg-gradient-to-br from-[#0d0d0d] to-[#0a0a0a] rounded-xl border ${colors.border} p-4 hover:border-white/[0.15] transition-all shadow-lg hover:shadow-xl ${colors.glow}`}
    >
      {/* Glow effect */}
      <div className={`absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br ${colors.bg} blur-xl -z-10`} />

      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.08] rounded-md transition-colors">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl overflow-hidden z-10"
            >
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center ${colors.icon} ring-1 ring-white/[0.05]`}>
            {config.icon}
          </div>
          <span className="text-xs text-gray-500 font-medium">{config.title}</span>
        </div>
        {config.premium && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-full border border-amber-500/30">
            <Sparkles className="w-2.5 h-2.5 text-amber-400" />
            <span className="text-[8px] font-bold text-amber-400">PRO</span>
          </div>
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold tracking-tight">
            {typeof getValue() === "number" ? <AnimatedCounter value={getValue() as number} /> : getValue()}
          </p>
          {change !== 0 && (
            <div className={`flex items-center gap-0.5 mt-1 ${isGood ? "text-emerald-400" : "text-red-400"}`}>
              {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              <span className="text-[11px] font-medium">{Math.abs(change).toFixed(1)}%</span>
              <span className="text-[10px] text-gray-600 ml-1">vs last week</span>
            </div>
          )}
        </div>
        <div className="w-16">
          <SparklineChart data={sparklineData} color={config.color} height={32} />
        </div>
      </div>
    </motion.div>
  );
}

// ============================================
// SYSTEM HEALTH WIDGET
// ============================================

function SystemHealthWidget({ onRemove }: { onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const [metrics, setMetrics] = useState({
    cpu: 45,
    memory: 62,
    network: 89,
    disk: 34,
    latency: 42,
    uptime: 99.97,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics({
        cpu: Math.min(100, Math.max(20, metrics.cpu + (Math.random() - 0.5) * 10)),
        memory: Math.min(100, Math.max(40, metrics.memory + (Math.random() - 0.5) * 5)),
        network: Math.min(100, Math.max(70, metrics.network + (Math.random() - 0.5) * 8)),
        disk: Math.min(100, Math.max(20, metrics.disk + (Math.random() - 0.5) * 2)),
        latency: Math.min(100, Math.max(20, metrics.latency + (Math.random() - 0.5) * 15)),
        uptime: 99.97,
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [metrics]);

  const servers = [
    { name: "API-01", status: "healthy", region: "US-East", load: 45 },
    { name: "API-02", status: "healthy", region: "US-West", load: 38 },
    { name: "DB-Primary", status: "healthy", region: "US-East", load: 52 },
    { name: "DB-Replica", status: "healthy", region: "EU-West", load: 28 },
    { name: "Cache-01", status: "warning", region: "US-East", load: 78 },
    { name: "Worker-01", status: "healthy", region: "US-East", load: 61 },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy": return "bg-emerald-500";
      case "warning": return "bg-amber-500";
      case "critical": return "bg-red-500";
      default: return "bg-gray-500";
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative group bg-gradient-to-br from-[#0d0d0d] to-[#080808] rounded-xl border border-cyan-500/20 p-5 hover:border-cyan-500/30 transition-all"
    >
      {/* Animated background grid */}
      <div className="absolute inset-0 rounded-xl overflow-hidden opacity-20">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.03)_1px,transparent_1px)] bg-[size:20px_20px]" />
      </div>

      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.08] rounded-md">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl z-20">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 ring-1 ring-cyan-500/20">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                System Health
                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 rounded-full">
                  <PulseDot color="emerald" size="sm" />
                  <span className="text-[9px] text-emerald-400 font-medium">All Systems Operational</span>
                </span>
              </h3>
              <p className="text-[10px] text-gray-500">Infrastructure monitoring</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-emerald-400">{metrics.uptime}%</p>
            <p className="text-[10px] text-gray-500">Uptime</p>
          </div>
        </div>

        {/* Resource Meters */}
        <div className="grid grid-cols-4 gap-4 mb-5">
          {[
            { label: "CPU", value: metrics.cpu, icon: <Cpu className="w-3.5 h-3.5" />, color: "cyan" },
            { label: "Memory", value: metrics.memory, icon: <HardDrive className="w-3.5 h-3.5" />, color: "purple" },
            { label: "Network", value: metrics.network, icon: <Wifi className="w-3.5 h-3.5" />, color: "blue" },
            { label: "Disk", value: metrics.disk, icon: <Database className="w-3.5 h-3.5" />, color: "amber" },
          ].map((item) => (
            <div key={item.label} className="text-center">
              <CircularProgress value={Math.round(item.value)} size={56} strokeWidth={4} color={item.color} />
              <div className="flex items-center justify-center gap-1 mt-2 text-gray-400">
                {item.icon}
                <span className="text-[10px] font-medium">{item.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Server Grid */}
        <div className="grid grid-cols-3 gap-2">
          {servers.map((server) => (
            <motion.div
              key={server.name}
              whileHover={{ scale: 1.02 }}
              className="p-2.5 bg-[#151515] rounded-lg border border-white/[0.04] hover:border-white/[0.08] transition-all"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${getStatusColor(server.status)}`} />
                  <span className="text-[10px] font-medium">{server.name}</span>
                </div>
                <span className="text-[9px] text-gray-600">{server.region}</span>
              </div>
              <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
                <motion.div
                  className={`h-full ${server.load > 70 ? "bg-amber-500" : "bg-cyan-500"}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${server.load}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
              </div>
              <p className="text-[9px] text-gray-600 mt-1">{server.load}% load</p>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================
// REVENUE CHART WIDGET
// ============================================

function RevenueChartWidget({ onRemove }: { onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const [timeframe, setTimeframe] = useState<"24h" | "7d" | "30d">("7d");

  const revenueData = {
    "24h": [1200, 1800, 2200, 1900, 2500, 2800, 3100, 2900, 3400, 3200, 3600, 3800],
    "7d": [12000, 15000, 18000, 16000, 22000, 25000, 28000],
    "30d": [45000, 52000, 48000, 58000, 62000, 55000, 68000, 72000, 65000, 78000, 82000, 85000],
  };

  const data = revenueData[timeframe];
  const total = data.reduce((a, b) => a + b, 0);
  const avg = total / data.length;
  const growth = ((data[data.length - 1] - data[0]) / data[0]) * 100;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative group bg-gradient-to-br from-[#0d0d0d] to-[#080808] rounded-xl border border-emerald-500/20 p-5 hover:border-emerald-500/30 transition-all"
    >
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.08] rounded-md">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl z-20">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 ring-1 ring-emerald-500/20">
            <AreaChart className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Revenue Analytics</h3>
            <p className="text-[10px] text-gray-500">Platform earnings over time</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-[#151515] rounded-lg p-0.5">
          {(["24h", "7d", "30d"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTimeframe(t)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-all ${
                timeframe === t ? "bg-emerald-500/20 text-emerald-400" : "text-gray-500 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 bg-[#151515] rounded-lg border border-white/[0.04]">
          <p className="text-[10px] text-gray-500 mb-1">Total Revenue</p>
          <p className="text-lg font-bold text-emerald-400">${(total / 1000).toFixed(1)}k</p>
        </div>
        <div className="p-3 bg-[#151515] rounded-lg border border-white/[0.04]">
          <p className="text-[10px] text-gray-500 mb-1">Average</p>
          <p className="text-lg font-bold">${(avg / 1000).toFixed(1)}k</p>
        </div>
        <div className="p-3 bg-[#151515] rounded-lg border border-white/[0.04]">
          <p className="text-[10px] text-gray-500 mb-1">Growth</p>
          <p className={`text-lg font-bold ${growth >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {growth >= 0 ? "+" : ""}{growth.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="h-32">
        <SparklineChart data={data} color="emerald" height={128} />
      </div>
    </motion.div>
  );
}

// ============================================
// HOURLY ACTIVITY CHART WIDGET
// ============================================

function HourlyChartWidget({ stats, onRemove }: { stats: StatsData | null; onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);

  // Use real hourly data or generate mock data
  const hourlyData = stats?.hourlyData || Array.from({ length: 24 }, (_, i) => ({
    hour: new Date(Date.now() - (23 - i) * 3600000).toISOString(),
    count: Math.floor(Math.random() * 50) + 10,
    volume: Math.floor(Math.random() * 50000) + 5000,
  }));

  const maxCount = Math.max(...hourlyData.map(h => h.count), 1);
  const totalTx = hourlyData.reduce((sum, h) => sum + h.count, 0);
  const totalVolume = hourlyData.reduce((sum, h) => sum + h.volume, 0);
  const avgTxPerHour = totalTx / hourlyData.length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative group bg-gradient-to-br from-[#0d0d0d] to-[#080808] rounded-xl border border-purple-500/20 p-5 hover:border-purple-500/30 transition-all"
    >
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.08] rounded-md">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl z-20">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 ring-1 ring-purple-500/20">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">24h Activity</h3>
            <p className="text-[10px] text-gray-500">Transactions per hour</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-purple-500/10 rounded-lg">
            <Gauge className="w-3 h-3 text-purple-400" />
            <span className="text-[10px] font-bold text-purple-400">{stats?.txPerMinute?.toFixed(1) || '0'}/min</span>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 bg-[#151515] rounded-lg border border-white/[0.04]">
          <p className="text-[10px] text-gray-500 mb-1">Total TX (24h)</p>
          <p className="text-lg font-bold text-purple-400">{totalTx.toLocaleString()}</p>
        </div>
        <div className="p-3 bg-[#151515] rounded-lg border border-white/[0.04]">
          <p className="text-[10px] text-gray-500 mb-1">Volume (24h)</p>
          <p className="text-lg font-bold">${(totalVolume / 1000).toFixed(1)}k</p>
        </div>
        <div className="p-3 bg-[#151515] rounded-lg border border-white/[0.04]">
          <p className="text-[10px] text-gray-500 mb-1">Avg/Hour</p>
          <p className="text-lg font-bold text-cyan-400">{avgTxPerHour.toFixed(1)}</p>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="h-24 flex items-end gap-0.5">
        {hourlyData.slice(-24).map((data, i) => {
          const height = (data.count / maxCount) * 100;
          const hour = new Date(data.hour).getHours();
          const isCurrentHour = hour === new Date().getHours();
          return (
            <motion.div
              key={i}
              className="flex-1 group/bar relative"
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(height, 4)}%` }}
              transition={{ delay: i * 0.02, duration: 0.5, ease: "easeOut" }}
            >
              <div
                className={`w-full h-full rounded-t-sm transition-colors ${
                  isCurrentHour
                    ? "bg-purple-400"
                    : "bg-purple-500/40 hover:bg-purple-500/60"
                }`}
              />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-[#1a1a1a] rounded text-[8px] text-white opacity-0 group-hover/bar:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                {data.count} tx @ {hour}:00
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Hour labels */}
      <div className="flex justify-between mt-2 px-0.5">
        <span className="text-[8px] text-gray-600">24h ago</span>
        <span className="text-[8px] text-gray-600">12h ago</span>
        <span className="text-[8px] text-gray-600">Now</span>
      </div>
    </motion.div>
  );
}

// ============================================
// SECURITY ALERTS WIDGET
// ============================================

function SecurityAlertsWidget({ onRemove }: { onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);

  const alerts = [
    { id: 1, type: "warning", title: "Rate Limit Warning", message: "High API usage from IP 192.168.1.xxx", time: "2m ago", severity: "medium" },
    { id: 2, type: "info", title: "New Login Location", message: "Admin login from new device in Singapore", time: "15m ago", severity: "low" },
    { id: 3, type: "success", title: "2FA Enabled", message: "Merchant verified enabled two-factor auth", time: "32m ago", severity: "info" },
    { id: 4, type: "warning", title: "Failed Auth Attempts", message: "3 failed login attempts for user@example.com", time: "1h ago", severity: "medium" },
    { id: 5, type: "info", title: "Security Scan Complete", message: "Weekly vulnerability scan - no issues found", time: "2h ago", severity: "info" },
  ];

  const getAlertStyle = (type: string) => {
    switch (type) {
      case "warning": return { icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" };
      case "success": return { icon: <ShieldCheck className="w-3.5 h-3.5" />, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" };
      case "error": return { icon: <ShieldAlert className="w-3.5 h-3.5" />, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" };
      default: return { icon: <Shield className="w-3.5 h-3.5" />, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" };
    }
  };

  const threatLevel = { score: 12, label: "Low", color: "emerald" };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative group bg-gradient-to-br from-[#0d0d0d] to-[#080808] rounded-xl border border-red-500/20 p-5 hover:border-red-500/30 transition-all"
    >
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.08] rounded-md">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl z-20">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-400 ring-1 ring-red-500/20">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Security Center</h3>
            <p className="text-[10px] text-gray-500">Threat monitoring & alerts</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-2 px-3 py-1.5 bg-${threatLevel.color}-500/10 rounded-lg border border-${threatLevel.color}-500/20`}>
            <Gauge className="w-4 h-4 text-emerald-400" />
            <div>
              <p className="text-[10px] text-gray-500">Threat Level</p>
              <p className="text-sm font-bold text-emerald-400">{threatLevel.label}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Security Metrics */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: "Blocked", value: "2.4k", color: "red" },
          { label: "Monitored", value: "156", color: "amber" },
          { label: "Verified", value: "89%", color: "emerald" },
          { label: "Encrypted", value: "100%", color: "blue" },
        ].map((metric) => (
          <div key={metric.label} className="p-2 bg-[#151515] rounded-lg border border-white/[0.04] text-center">
            <p className={`text-sm font-bold text-${metric.color}-400`}>{metric.value}</p>
            <p className="text-[9px] text-gray-500">{metric.label}</p>
          </div>
        ))}
      </div>

      {/* Alerts List */}
      <div className="space-y-2 max-h-[200px] overflow-y-auto">
        {alerts.map((alert, i) => {
          const style = getAlertStyle(alert.type);
          return (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`flex items-start gap-3 p-3 bg-[#151515] rounded-lg border ${style.border} hover:border-white/[0.1] transition-colors`}
            >
              <div className={`w-7 h-7 rounded-lg ${style.bg} flex items-center justify-center ${style.color} shrink-0`}>
                {style.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium mb-0.5">{alert.title}</p>
                <p className="text-[10px] text-gray-500 truncate">{alert.message}</p>
              </div>
              <span className="text-[9px] text-gray-600 shrink-0">{alert.time}</span>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ============================================
// GLOBAL ACTIVITY WIDGET
// ============================================

function GlobalActivityWidget({ onRemove }: { onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const [activeRegion, setActiveRegion] = useState<string | null>(null);

  const regions = [
    { id: "na", name: "North America", trades: 12453, volume: "$2.4M", growth: "+12%", x: 20, y: 35 },
    { id: "eu", name: "Europe", trades: 8921, volume: "$1.8M", growth: "+8%", x: 48, y: 28 },
    { id: "asia", name: "Asia Pacific", trades: 15234, volume: "$3.1M", growth: "+24%", x: 75, y: 40 },
    { id: "latam", name: "Latin America", trades: 3421, volume: "$680k", growth: "+15%", x: 28, y: 65 },
    { id: "africa", name: "Africa", trades: 1892, volume: "$320k", growth: "+32%", x: 52, y: 55 },
  ];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative group bg-gradient-to-br from-[#0d0d0d] to-[#080808] rounded-xl border border-cyan-500/20 p-5 hover:border-cyan-500/30 transition-all overflow-hidden"
    >
      {/* Background globe lines */}
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 100 100">
          {[20, 35, 50, 65, 80].map((y) => (
            <motion.path
              key={y}
              d={`M 0 ${y} Q 50 ${y - 10} 100 ${y}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="0.3"
              className="text-cyan-500"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2, delay: y * 0.01 }}
            />
          ))}
          {[20, 40, 60, 80].map((x) => (
            <motion.line
              key={x}
              x1={x}
              y1="10"
              x2={x}
              y2="90"
              stroke="currentColor"
              strokeWidth="0.3"
              className="text-cyan-500"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.5, delay: x * 0.01 }}
            />
          ))}
        </svg>
      </div>

      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.08] rounded-md">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl z-20">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 ring-1 ring-cyan-500/20">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Global Activity</h3>
              <p className="text-[10px] text-gray-500">Worldwide transaction map</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PulseDot color="cyan" />
            <span className="text-[10px] text-cyan-400">Live</span>
          </div>
        </div>

        {/* Globe Visualization */}
        <div className="relative h-40 mb-4">
          {regions.map((region) => (
            <motion.div
              key={region.id}
              className="absolute cursor-pointer"
              style={{ left: `${region.x}%`, top: `${region.y}%` }}
              onHoverStart={() => setActiveRegion(region.id)}
              onHoverEnd={() => setActiveRegion(null)}
              whileHover={{ scale: 1.5 }}
            >
              <motion.div
                className="w-3 h-3 rounded-full bg-cyan-500"
                animate={{
                  boxShadow: activeRegion === region.id
                    ? "0 0 20px rgba(6, 182, 212, 0.8)"
                    : "0 0 10px rgba(6, 182, 212, 0.4)",
                }}
              />
              <motion.div
                className="absolute inset-0 rounded-full bg-cyan-500"
                animate={{ scale: [1, 2, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, delay: Math.random() * 2 }}
              />
              <AnimatePresence>
                {activeRegion === region.id && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 5, scale: 0.9 }}
                    className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-[#1a1a1a] rounded-lg border border-cyan-500/30 shadow-xl whitespace-nowrap z-20"
                  >
                    <p className="text-xs font-semibold text-cyan-400">{region.name}</p>
                    <p className="text-[10px] text-gray-400">{region.trades.toLocaleString()} trades • {region.volume}</p>
                    <p className="text-[10px] text-emerald-400">{region.growth}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}

          {/* Connection lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {regions.slice(0, -1).map((from, i) => {
              const to = regions[(i + 2) % regions.length];
              return (
                <motion.line
                  key={`${from.id}-${to.id}`}
                  x1={`${from.x}%`}
                  y1={`${from.y}%`}
                  x2={`${to.x}%`}
                  y2={`${to.y}%`}
                  stroke="rgba(6, 182, 212, 0.2)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 2, delay: i * 0.3 }}
                />
              );
            })}
          </svg>
        </div>

        {/* Region Stats */}
        <div className="grid grid-cols-5 gap-2">
          {regions.map((region) => (
            <motion.div
              key={region.id}
              whileHover={{ scale: 1.05 }}
              onHoverStart={() => setActiveRegion(region.id)}
              onHoverEnd={() => setActiveRegion(null)}
              className={`p-2 rounded-lg border cursor-pointer transition-all ${
                activeRegion === region.id
                  ? "bg-cyan-500/10 border-cyan-500/30"
                  : "bg-[#151515] border-white/[0.04] hover:border-white/[0.08]"
              }`}
            >
              <p className="text-[9px] text-gray-500 truncate">{region.name.split(" ")[0]}</p>
              <p className="text-xs font-bold">{region.volume}</p>
              <p className="text-[9px] text-emerald-400">{region.growth}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================
// TOP MERCHANTS WIDGET
// ============================================

function TopMerchantsWidget({ merchants, onRemove }: { merchants: ApiMerchant[]; onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative group bg-gradient-to-br from-[#0d0d0d] to-[#080808] rounded-xl border border-amber-500/20 p-5 hover:border-amber-500/30 transition-all"
    >
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.08] rounded-md">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl z-20">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 ring-1 ring-amber-500/20">
          <Crown className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Top Merchants</h3>
          <p className="text-[10px] text-gray-500">Highest volume this month</p>
        </div>
      </div>

      <div className="space-y-2">
        {merchants.length > 0 ? merchants.slice(0, 5).map((merchant, i) => (
          <motion.div
            key={merchant.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            whileHover={{ x: 4 }}
            className="flex items-center gap-3 p-3 bg-[#151515] rounded-lg border border-white/[0.04] hover:border-amber-500/20 transition-all cursor-pointer"
          >
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
              i === 0 ? "bg-gradient-to-br from-amber-400 to-amber-600 text-black" :
              i === 1 ? "bg-gradient-to-br from-gray-300 to-gray-500 text-black" :
              i === 2 ? "bg-gradient-to-br from-amber-600 to-amber-800 text-white" :
              "bg-[#1a1a1a] text-gray-500"
            }`}>
              {i + 1}
            </div>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1a1a1a] to-[#252525] flex items-center justify-center text-xl ring-1 ring-white/[0.05]">
              {merchant.emoji}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{merchant.name}</p>
                {merchant.rating > 4.8 && <Award className="w-3.5 h-3.5 text-amber-400" />}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="flex items-center gap-0.5 text-amber-400">
                  <Star className="w-3 h-3 fill-current" />
                  <span className="text-[10px] font-medium">{merchant.rating.toFixed(2)}</span>
                </div>
                <span className="text-[10px] text-gray-600">•</span>
                <span className="text-[10px] text-gray-500">{merchant.trades} trades</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold">${merchant.volume >= 1000 ? `${(merchant.volume / 1000).toFixed(0)}k` : merchant.volume.toFixed(0)}</p>
              <p className="text-[10px] text-emerald-400">+{(Math.random() * 20 + 5).toFixed(1)}%</p>
            </div>
          </motion.div>
        )) : (
          <div className="text-center py-8 text-gray-500 text-xs">No merchants found</div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================
// LIVE ORDERS WIDGET
// ============================================

function LiveOrdersWidget({ orders, onRemove }: { orders: ApiOrder[]; onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "active" | "completing">("all");
  const [localOrders, setLocalOrders] = useState(orders);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setLocalOrders(orders); }, [orders]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLocalOrders(prev => prev.map(order => ({ ...order })));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-white/[0.08] text-gray-400 border-white/[0.12]";
      case "accepted": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "escrowed": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "payment_sent": return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "payment_confirmed": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "completed": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      default: return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "pending": return "Pending";
      case "accepted": return "Accepted";
      case "escrowed": return "Escrowed";
      case "payment_sent": return "Paid";
      case "payment_confirmed": return "Confirmed";
      case "completed": return "Done";
      default: return status;
    }
  };

  const filteredOrders = localOrders.filter(order => {
    if (filter === "all") return true;
    if (filter === "pending") return order.status === "pending";
    if (filter === "active") return ["accepted", "escrowed", "payment_sent"].includes(order.status);
    if (filter === "completing") return ["payment_confirmed", "completed"].includes(order.status);
    return true;
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative group bg-gradient-to-br from-[#0d0d0d] to-[#080808] rounded-xl border border-blue-500/20 p-5 hover:border-blue-500/30 transition-all"
    >
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.08] rounded-md">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl z-20">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 ring-1 ring-blue-500/20">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Live Orders</h3>
            <p className="text-[10px] text-gray-500">Real-time order feed</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PulseDot color="blue" />
          <span className="text-[10px] text-blue-400">{localOrders.length} active</span>
        </div>
      </div>

      <div className="flex gap-1 mb-4 bg-[#151515] rounded-lg p-1">
        {(["all", "pending", "active", "completing"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${
              filter === f ? "bg-blue-500/20 text-blue-400" : "text-gray-500 hover:text-white"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-2 max-h-[280px] overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {filteredOrders.length > 0 ? filteredOrders.map((order) => {
            const expiresIn = mounted ? Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - Date.now()) / 1000)) : 0;
            return (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                whileHover={{ x: 4 }}
                className="flex items-center gap-3 p-3 bg-[#151515] rounded-lg border border-white/[0.04] hover:border-blue-500/20 transition-all cursor-pointer"
              >
                <div className="flex items-center -space-x-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#1a1a1a] to-[#252525] flex items-center justify-center text-sm border-2 border-[#151515] z-10 ring-1 ring-white/[0.05]">{getUserEmoji(order.user)}</div>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#1a1a1a] to-[#252525] flex items-center justify-center text-sm border-2 border-[#151515] ring-1 ring-white/[0.05]">{getUserEmoji(order.merchant)}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-300">{order.orderNumber}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${getStatusColor(order.status)}`}>
                      {getStatusLabel(order.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-500 mt-0.5">
                    <span className="truncate max-w-[60px]">{order.user}</span>
                    <ArrowRight className="w-2.5 h-2.5" />
                    <span className="truncate max-w-[60px]">{order.merchant}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">${order.amount.toLocaleString()}</p>
                  <p className={`text-[10px] font-mono ${expiresIn < 60 ? "text-red-400" : expiresIn < 180 ? "text-amber-400" : "text-gray-500"}`}>
                    {mounted ? `${Math.floor(expiresIn / 60)}:${(expiresIn % 60).toString().padStart(2, "0")}` : "--:--"}
                  </p>
                </div>
              </motion.div>
            );
          }) : (
            <div className="text-center py-8 text-gray-500 text-xs">No orders found</div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ============================================
// BIG TRANSACTIONS WIDGET
// ============================================

function BigTransactionsWidget({ orders, onRemove }: { orders: ApiOrder[]; onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const bigOrders = orders.filter(o => o.amount >= 5000);
  const totalVolume = bigOrders.reduce((sum, o) => sum + o.amount, 0);
  const totalFees = bigOrders.reduce((sum, o) => sum + o.amount * 0.005, 0);

  const getStatusBadge = (status: string) => {
    if (status === "completed") return <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Completed</span>;
    if (["accepted", "escrowed", "payment_sent", "payment_confirmed"].includes(status)) return <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">In Progress</span>;
    return <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-white/[0.08] text-gray-400 border border-white/[0.12]">Pending</span>;
  };

  const formatTimeAgo = (dateStr: string) => {
    if (!mounted) return "--";
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative group bg-gradient-to-br from-[#0d0d0d] to-[#080808] rounded-xl border border-purple-500/20 p-5 hover:border-purple-500/30 transition-all"
    >
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.08] rounded-md">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl z-20">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 ring-1 ring-purple-500/20">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Big Transactions</h3>
            <p className="text-[10px] text-gray-500">$5,000+ trades</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-purple-400">${(totalVolume / 1000).toFixed(0)}k</p>
          <p className="text-[10px] text-emerald-400">+${totalFees.toFixed(0)} fees</p>
        </div>
      </div>

      <div className="space-y-2 max-h-[280px] overflow-y-auto">
        {bigOrders.length > 0 ? bigOrders.map((order, i) => (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileHover={{ x: 4 }}
            className={`flex items-center gap-3 p-3 bg-[#151515] rounded-lg border transition-all cursor-pointer ${
              order.status !== "completed" && order.status !== "pending"
                ? "border-amber-500/20 hover:border-amber-500/30"
                : "border-white/[0.04] hover:border-purple-500/20"
            }`}
          >
            <div className="flex items-center -space-x-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#1a1a1a] to-[#252525] flex items-center justify-center text-base border-2 border-[#151515] z-10 ring-1 ring-white/[0.05]">{getUserEmoji(order.user)}</div>
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#1a1a1a] to-[#252525] flex items-center justify-center text-base border-2 border-[#151515] ring-1 ring-white/[0.05]">{getUserEmoji(order.merchant)}</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium">{order.orderNumber}</span>
                {getStatusBadge(order.status)}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                <span className="truncate max-w-[60px]">{order.user}</span>
                <ArrowRight className="w-2.5 h-2.5" />
                <span className="truncate max-w-[60px]">{order.merchant}</span>
                <span className="text-gray-600">•</span>
                <span className="text-gray-600">{formatTimeAgo(order.createdAt)}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-base font-bold">${order.amount.toLocaleString()}</p>
              <p className="text-[10px] text-emerald-400">+${(order.amount * 0.005).toFixed(0)} fee</p>
            </div>
          </motion.div>
        )) : (
          <div className="text-center py-8 text-gray-500 text-xs">No big transactions found</div>
        )}
      </div>

      {bigOrders.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/[0.04] flex items-center justify-between">
          <span className="text-[10px] text-gray-500">{bigOrders.length} big transactions</span>
          <span className="text-[10px] text-emerald-400 font-medium">+${totalFees.toFixed(0)} earned</span>
        </div>
      )}
    </motion.div>
  );
}

// ============================================
// RECENT ACTIVITY WIDGET
// ============================================

function RecentActivityWidget({ activities, onRemove }: { activities: ApiActivity[]; onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success": return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
      case "warning": return <AlertCircle className="w-3.5 h-3.5 text-amber-400" />;
      case "error": return <XCircle className="w-3.5 h-3.5 text-red-400" />;
      default: return <Activity className="w-3.5 h-3.5 text-blue-400" />;
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative group bg-gradient-to-br from-[#0d0d0d] to-[#080808] rounded-xl border border-white/[0.08] p-5 hover:border-white/[0.12] transition-all"
    >
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.08] rounded-md">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl z-20">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center text-gray-400 ring-1 ring-white/[0.08]">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Recent Activity</h3>
            <p className="text-[10px] text-gray-500">Live platform events</p>
          </div>
        </div>
        <PulseDot color="emerald" />
      </div>

      <div className="space-y-2 max-h-[280px] overflow-y-auto">
        {activities.length > 0 ? activities.map((activity, i) => (
          <motion.div
            key={activity.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
            className="flex items-center gap-3 p-3 bg-[#151515] rounded-lg border border-white/[0.04] hover:border-white/[0.08] transition-colors"
          >
            <div className="w-7 h-7 rounded-lg bg-[#1a1a1a] flex items-center justify-center ring-1 ring-white/[0.05]">
              {getStatusIcon(activity.status)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-300 truncate">{activity.message}</p>
            </div>
            <span className="text-[10px] text-gray-600 shrink-0">{activity.time}</span>
          </motion.div>
        )) : (
          <div className="text-center py-8 text-gray-500 text-xs">No recent activity</div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================
// ADD WIDGET MODAL
// ============================================

function AddWidgetModal({ show, onClose, onAdd, existingWidgets }: { show: boolean; onClose: () => void; onAdd: (type: WidgetType) => void; existingWidgets: WidgetType[] }) {
  const availableWidgets = (Object.keys(widgetConfigs) as WidgetType[]).filter((type) => !existingWidgets.includes(type));

  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg"
          >
            <div className="bg-gradient-to-br from-[#151515] to-[#0d0d0d] rounded-2xl border border-white/[0.1] shadow-2xl overflow-hidden">
              <div className="px-6 py-5 border-b border-white/[0.06] flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-white/[0.1] to-white/[0.05] flex items-center justify-center ring-1 ring-white/[0.1]">
                    <Plus className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">Add Widget</h2>
                    <p className="text-xs text-gray-500">Choose a widget to add to your dashboard</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              <div className="p-5 max-h-[60vh] overflow-y-auto">
                {availableWidgets.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    {availableWidgets.map((type) => {
                      const config = widgetConfigs[type];
                      const colors = getColorClasses(config.color);
                      return (
                        <motion.button
                          key={type}
                          whileHover={{ scale: 1.02, y: -2 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => { onAdd(type); onClose(); }}
                          className={`relative p-4 bg-[#1a1a1a] rounded-xl border ${colors.border} hover:border-white/[0.2] transition-all text-left overflow-hidden group`}
                        >
                          <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br ${colors.bg}`} />
                          <div className="relative">
                            <div className="flex items-center justify-between mb-3">
                              <div className={`w-10 h-10 rounded-xl ${colors.bg} flex items-center justify-center ${colors.icon} ring-1 ring-white/[0.05]`}>
                                {config.icon}
                              </div>
                              {config.premium && (
                                <div className="flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-full border border-amber-500/30">
                                  <Sparkles className="w-3 h-3 text-amber-400" />
                                  <span className="text-[9px] font-bold text-amber-400">PRO</span>
                                </div>
                              )}
                            </div>
                            <p className="text-sm font-medium mb-1">{config.title}</p>
                            <p className="text-[11px] text-gray-500">{config.description}</p>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="w-8 h-8 text-emerald-400" />
                    </div>
                    <p className="text-sm text-gray-400">All widgets are already added!</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ============================================
// COMMAND PALETTE
// ============================================

function CommandPalette({ show, onClose }: { show: boolean; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (show && inputRef.current) {
      inputRef.current.focus();
    }
  }, [show]);

  const commands = [
    { id: "dashboard", icon: <LayoutDashboard className="w-4 h-4" />, label: "Go to Dashboard", shortcut: "D" },
    { id: "merchants", icon: <Users className="w-4 h-4" />, label: "View Merchants", shortcut: "M" },
    { id: "orders", icon: <Clock className="w-4 h-4" />, label: "View Orders", shortcut: "O" },
    { id: "disputes", icon: <AlertTriangle className="w-4 h-4" />, label: "View Disputes", shortcut: "I" },
    { id: "settings", icon: <Settings className="w-4 h-4" />, label: "Open Settings", shortcut: "S" },
    { id: "refresh", icon: <RefreshCw className="w-4 h-4" />, label: "Refresh Data", shortcut: "R" },
    { id: "export", icon: <Download className="w-4 h-4" />, label: "Export Report", shortcut: "E" },
    { id: "theme", icon: <Palette className="w-4 h-4" />, label: "Toggle Theme", shortcut: "T" },
  ];

  const filteredCommands = commands.filter(cmd =>
    cmd.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-full max-w-md"
          >
            <div className="bg-[#151515] rounded-2xl border border-white/[0.1] shadow-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
                <Search className="w-5 h-5 text-gray-500" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search commands..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-600"
                />
                <div className="flex items-center gap-1 px-2 py-1 bg-white/[0.04] rounded-md text-[10px] text-gray-500">
                  <Command className="w-3 h-3" />
                  <span>K</span>
                </div>
              </div>
              <div className="p-2 max-h-[300px] overflow-y-auto">
                {filteredCommands.map((cmd, i) => (
                  <motion.button
                    key={cmd.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                    onClick={onClose}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors text-left group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center text-gray-400 group-hover:text-white group-hover:bg-white/[0.08] transition-colors">
                      {cmd.icon}
                    </div>
                    <span className="flex-1 text-sm text-gray-300 group-hover:text-white transition-colors">{cmd.label}</span>
                    <div className="px-1.5 py-0.5 rounded bg-white/[0.04] text-[10px] text-gray-500 font-mono">
                      {cmd.shortcut}
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function AdminConsolePage() {
  const { playSound } = useSounds();
  const { setActor, subscribe, unsubscribe, isConnected } = usePusher();
  const [widgets, setWidgets] = useState<Widget[]>(initialWidgets);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mounted, setMounted] = useState(false);

  // API data states
  const [stats, setStats] = useState<StatsData | null>(null);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [merchants, setMerchants] = useState<ApiMerchant[]>([]);
  const [activities, setActivities] = useState<ApiActivity[]>([]);

  // Keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
      if (e.key === "Escape") {
        setShowCommandPalette(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => { setActor('merchant', 'admin'); }, [setActor]);
  useEffect(() => { setMounted(true); }, []);

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [statsRes, ordersRes, merchantsRes, activityRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/orders?limit=100'),
        fetch('/api/admin/merchants?sort=volume&limit=10'),
        fetch('/api/admin/activity?limit=15'),
      ]);

      const [statsData, ordersData, merchantsData, activityData] = await Promise.all([
        statsRes.json(), ordersRes.json(), merchantsRes.json(), activityRes.json(),
      ]);

      if (statsData.success) setStats(statsData.data);
      if (ordersData.success) setOrders(ordersData.data);
      if (merchantsData.success) setMerchants(merchantsData.data);
      if (activityData.success) setActivities(activityData.data);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Error fetching admin data:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!isConnected) return;
    const channel = subscribe('private-admin');
    if (!channel) return;

    const handleOrderCreated = () => { fetchData(); playSound('notification'); };
    const handleOrderUpdated = () => { fetchData(); };

    channel.bind('order:created', handleOrderCreated);
    channel.bind('order:status-updated', handleOrderUpdated);

    return () => {
      channel.unbind('order:created', handleOrderCreated);
      channel.unbind('order:status-updated', handleOrderUpdated);
      unsubscribe('private-admin');
    };
  }, [isConnected, subscribe, unsubscribe, fetchData, playSound]);

  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const addWidget = (type: WidgetType) => {
    const largeWidgetTypes: WidgetType[] = ["top-merchants", "recent-activity", "live-orders", "big-transactions", "system-health", "security-alerts", "revenue-chart", "user-growth", "global-activity", "network-status", "compliance", "ai-insights"];
    const newWidget: Widget = { id: `w${Date.now()}`, type, size: largeWidgetTypes.includes(type) ? "lg" : "sm", visible: true };
    setWidgets([...widgets, newWidget]);
  };

  const removeWidget = (id: string) => setWidgets(widgets.filter((w) => w.id !== id));

  const existingWidgetTypes = widgets.map((w) => w.type);
  const smallWidgets = widgets.filter((w) => w.size === "sm" && w.visible);
  const largeWidgets = widgets.filter((w) => w.size === "lg" && w.visible);

  const sidebarStats = [
    { label: "Platform Uptime", value: "99.97%", icon: <Zap className="w-3.5 h-3.5" />, color: "emerald" },
    { label: "API Latency", value: "42ms", icon: <Gauge className="w-3.5 h-3.5" />, color: "cyan" },
    { label: "TPS", value: "1,247", icon: <Activity className="w-3.5 h-3.5" />, color: "blue" },
    { label: "Total Merchants", value: stats?.totalMerchants?.toString() || "0", icon: <Building2 className="w-3.5 h-3.5" />, color: "purple" },
    { label: "Total Users", value: stats?.totalUsers?.toLocaleString() || "0", icon: <Users className="w-3.5 h-3.5" />, color: "white" },
    { label: "Active Disputes", value: stats?.disputes?.toString() || "0", icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "red" },
    { label: "Success Rate", value: stats?.successRate ? `${stats.successRate.toFixed(1)}%` : "0%", icon: <Target className="w-3.5 h-3.5" />, color: "emerald" },
    { label: "Encryption", value: "AES-256", icon: <Lock className="w-3.5 h-3.5" />, color: "violet" },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col">
      {/* Ambient Background Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/4 w-[800px] h-[600px] bg-gradient-to-br from-cyan-500/[0.03] to-transparent rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-1/4 w-[600px] h-[400px] bg-gradient-to-tr from-purple-500/[0.02] to-transparent rounded-full blur-[100px]" />
        <div className="absolute top-1/3 left-1/2 w-[500px] h-[500px] bg-gradient-to-b from-emerald-500/[0.015] to-transparent rounded-full blur-[150px]" />
        {/* Grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:60px_60px]" />
      </div>

      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-[#050505]/80 backdrop-blur-2xl border-b border-white/[0.04]">
        <div className="px-4 h-14 flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <motion.div
              className="w-9 h-9 rounded-xl bg-gradient-to-br from-white/[0.1] to-white/[0.05] flex items-center justify-center text-white font-bold text-sm ring-1 ring-white/[0.1]"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              B
            </motion.div>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold">Blip Admin</p>
              <p className="text-[10px] text-gray-500">Enterprise Dashboard</p>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="flex items-center gap-1 ml-4">
            <Link href="/admin" className="px-3 py-1.5 text-xs font-medium bg-white/[0.08] rounded-lg text-white flex items-center gap-2">
              <LayoutDashboard className="w-3.5 h-3.5" />
              Console
            </Link>
            <Link href="/merchant" className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-all flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5" />
              Merchant
            </Link>
            <Link href="/compliance" className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-all flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" />
              Compliance
            </Link>
          </nav>

          <div className="flex-1" />

          {/* Command Palette Trigger */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCommandPalette(true)}
            className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.06] border border-white/[0.06] rounded-lg transition-all"
          >
            <Search className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs text-gray-500">Search...</span>
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-white/[0.04] rounded text-[10px] text-gray-600 font-mono">
              <Command className="w-2.5 h-2.5" />K
            </div>
          </motion.button>

          {/* Last Updated */}
          <div className="hidden md:flex items-center gap-2 text-[10px] text-gray-500">
            <span>Updated: {mounted ? lastRefresh.toLocaleTimeString() : '--:--:--'}</span>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={fetchData}
              disabled={isRefreshing}
              className="p-1.5 hover:bg-white/[0.04] rounded-md transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </motion.button>
          </div>

          {/* Add Widget Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowAddWidget(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-white to-gray-200 text-black rounded-lg text-xs font-bold hover:from-gray-100 hover:to-gray-300 transition-all shadow-lg shadow-white/10"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
            <span className="hidden sm:inline">Add Widget</span>
          </motion.button>

          {/* Live Indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <PulseDot color="emerald" />
            <span className="text-[10px] text-emerald-400 font-medium">Live</span>
          </div>

          {/* User Avatar */}
          <div className="flex items-center gap-3 pl-3 border-l border-white/[0.08]">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/20 flex items-center justify-center text-lg">
              ⚡
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-medium">Admin</p>
              <p className="text-[10px] text-gray-500">Super User</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Stats Sidebar */}
        <aside className="hidden lg:flex w-64 border-r border-white/[0.04] bg-[#080808]/50 flex-col">
          <div className="p-4 border-b border-white/[0.04]">
            <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
              <Radio className="w-3 h-3" />
              System Metrics
            </h3>
          </div>

          <div className="flex-1 p-3 space-y-2 overflow-y-auto">
            {sidebarStats.map((stat, i) => {
              const colors = getColorClasses(stat.color);
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileHover={{ x: 4 }}
                  className="p-3 bg-[#0d0d0d] rounded-xl border border-white/[0.04] hover:border-white/[0.08] transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-7 h-7 rounded-lg ${colors.bg} flex items-center justify-center ${colors.icon} ring-1 ring-white/[0.05]`}>
                      {stat.icon}
                    </div>
                    <span className="text-[10px] text-gray-500 group-hover:text-gray-400 transition-colors">{stat.label}</span>
                  </div>
                  <p className="text-lg font-bold">{stat.value}</p>
                </motion.div>
              );
            })}
          </div>

          {/* Quick Actions */}
          <div className="p-3 border-t border-white/[0.04]">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
              <Zap className="w-3 h-3" />
              Quick Actions
            </p>
            <div className="space-y-1">
              {[
                { icon: <Settings className="w-3.5 h-3.5" />, label: "Settings" },
                { icon: <Shield className="w-3.5 h-3.5" />, label: "Merchants" },
                { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: "Disputes" },
                { icon: <Download className="w-3.5 h-3.5" />, label: "Export Data" },
              ].map((action) => (
                <motion.button
                  key={action.label}
                  whileHover={{ x: 4 }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-xs text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-all"
                >
                  {action.icon}
                  {action.label}
                  <ChevronRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100" />
                </motion.button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 overflow-auto relative z-10">
          {/* Header */}
          <div className="mb-8">
            <motion.h1
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-2xl font-bold flex items-center gap-3"
            >
              Admin Console
              <span className="px-2 py-0.5 bg-gradient-to-r from-violet-500/20 to-purple-500/20 rounded-full text-[10px] font-medium text-violet-400 border border-violet-500/20">
                v2.0
              </span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-sm text-gray-500 mt-1"
            >
              Real-time platform monitoring and analytics
            </motion.p>
          </div>

          {/* Small Widgets Grid */}
          {smallWidgets.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6"
            >
              <AnimatePresence mode="popLayout">
                {smallWidgets.map((widget) => (
                  <StatWidget key={widget.id} widget={widget} stats={stats} onRemove={() => removeWidget(widget.id)} />
                ))}
              </AnimatePresence>
            </motion.div>
          )}

          {/* Large Widgets Grid */}
          {largeWidgets.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-5"
            >
              <AnimatePresence mode="popLayout">
                {largeWidgets.map((widget) => {
                  if (widget.type === "system-health") return <SystemHealthWidget key={widget.id} onRemove={() => removeWidget(widget.id)} />;
                  if (widget.type === "revenue-chart") return <RevenueChartWidget key={widget.id} onRemove={() => removeWidget(widget.id)} />;
                  if (widget.type === "hourly-chart") return <HourlyChartWidget key={widget.id} stats={stats} onRemove={() => removeWidget(widget.id)} />;
                  if (widget.type === "security-alerts") return <SecurityAlertsWidget key={widget.id} onRemove={() => removeWidget(widget.id)} />;
                  if (widget.type === "global-activity") return <GlobalActivityWidget key={widget.id} onRemove={() => removeWidget(widget.id)} />;
                  if (widget.type === "live-orders") return <LiveOrdersWidget key={widget.id} orders={orders} onRemove={() => removeWidget(widget.id)} />;
                  if (widget.type === "big-transactions") return <BigTransactionsWidget key={widget.id} orders={orders} onRemove={() => removeWidget(widget.id)} />;
                  if (widget.type === "top-merchants") return <TopMerchantsWidget key={widget.id} merchants={merchants} onRemove={() => removeWidget(widget.id)} />;
                  if (widget.type === "recent-activity") return <RecentActivityWidget key={widget.id} activities={activities} onRemove={() => removeWidget(widget.id)} />;
                  return null;
                })}
              </AnimatePresence>
            </motion.div>
          )}

          {/* Empty State */}
          {widgets.filter((w) => w.visible).length === 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center h-[60vh]"
            >
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] flex items-center justify-center mb-6 ring-1 ring-white/[0.1]">
                <Boxes className="w-10 h-10 text-gray-600" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No Widgets</h3>
              <p className="text-sm text-gray-500 mb-6">Add widgets to start monitoring your platform</p>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowAddWidget(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-xl text-sm font-bold shadow-lg shadow-white/10"
              >
                <Plus className="w-4 h-4" />
                Add Widget
              </motion.button>
            </motion.div>
          )}
        </main>
      </div>

      {/* Modals */}
      <AddWidgetModal show={showAddWidget} onClose={() => setShowAddWidget(false)} onAdd={addWidget} existingWidgets={existingWidgetTypes} />
      <CommandPalette show={showCommandPalette} onClose={() => setShowCommandPalette(false)} />
    </div>
  );
}
