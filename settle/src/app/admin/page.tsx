"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
} from "lucide-react";
import Link from "next/link";
import { usePusher } from "@/context/PusherContext";
import { useSounds } from "@/hooks/useSounds";

// Widget types
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
  | "big-transactions";

type WidgetSize = "sm" | "md" | "lg";

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
}

// API Response types
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

// Widget configurations
const widgetConfigs: Record<WidgetType, WidgetConfig> = {
  "total-trades": {
    title: "Total Trades",
    icon: <Activity className="w-4 h-4" />,
    color: "emerald",
    description: "All-time completed trades",
  },
  "open-orders": {
    title: "Open Orders",
    icon: <Clock className="w-4 h-4" />,
    color: "amber",
    description: "Currently pending orders",
  },
  "volume-24h": {
    title: "24h Volume",
    icon: <TrendingUp className="w-4 h-4" />,
    color: "blue",
    description: "Trading volume in last 24h",
  },
  "active-merchants": {
    title: "Active Merchants",
    icon: <Users className="w-4 h-4" />,
    color: "purple",
    description: "Online merchants now",
  },
  "escrow-locked": {
    title: "Escrow Locked",
    icon: <Lock className="w-4 h-4" />,
    color: "amber",
    description: "Funds currently in escrow",
  },
  "disputes": {
    title: "Active Disputes",
    icon: <AlertTriangle className="w-4 h-4" />,
    color: "red",
    description: "Open dispute cases",
  },
  "success-rate": {
    title: "Success Rate",
    icon: <CheckCircle className="w-4 h-4" />,
    color: "emerald",
    description: "Trade completion rate",
  },
  "avg-time": {
    title: "Avg Completion",
    icon: <Zap className="w-4 h-4" />,
    color: "purple",
    description: "Average trade time",
  },
  "revenue": {
    title: "Platform Revenue",
    icon: <DollarSign className="w-4 h-4" />,
    color: "emerald",
    description: "Total platform fees",
  },
  "users-online": {
    title: "Total Users",
    icon: <Eye className="w-4 h-4" />,
    color: "blue",
    description: "Registered users",
  },
  "top-merchants": {
    title: "Top Merchants",
    icon: <Crown className="w-4 h-4" />,
    color: "amber",
    description: "Highest volume merchants",
  },
  "recent-activity": {
    title: "Recent Activity",
    icon: <Activity className="w-4 h-4" />,
    color: "white",
    description: "Latest platform events",
  },
  "live-orders": {
    title: "Live Orders",
    icon: <Clock className="w-4 h-4" />,
    color: "blue",
    description: "Real-time order feed",
  },
  "big-transactions": {
    title: "Big Transactions",
    icon: <Zap className="w-4 h-4" />,
    color: "purple",
    description: "High-value trades ($5k+)",
  },
};

// Initial widget layout
const initialWidgets: Widget[] = [
  { id: "w1", type: "total-trades", size: "sm", visible: true },
  { id: "w2", type: "open-orders", size: "sm", visible: true },
  { id: "w3", type: "volume-24h", size: "sm", visible: true },
  { id: "w4", type: "active-merchants", size: "sm", visible: true },
  { id: "w5", type: "escrow-locked", size: "sm", visible: true },
  { id: "w6", type: "disputes", size: "sm", visible: true },
  { id: "w7", type: "live-orders", size: "lg", visible: true },
  { id: "w8", type: "big-transactions", size: "lg", visible: true },
  { id: "w9", type: "top-merchants", size: "lg", visible: true },
  { id: "w10", type: "recent-activity", size: "lg", visible: true },
];

// Color helper
const getColorClasses = (color: string) => {
  const colors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", icon: "text-emerald-400" },
    amber: { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400", icon: "text-amber-400" },
    blue: { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400", icon: "text-blue-400" },
    purple: { bg: "bg-purple-500/10", border: "border-purple-500/20", text: "text-purple-400", icon: "text-purple-400" },
    red: { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-400", icon: "text-red-400" },
    white: { bg: "bg-white/[0.04]", border: "border-white/[0.08]", text: "text-gray-300", icon: "text-gray-400" },
  };
  return colors[color] || colors.white;
};

// Helper to get emoji from name
const getUserEmoji = (name: string): string => {
  const emojis = ["🦊", "🦧", "🐋", "🦄", "🔥", "💎", "🐺", "🦁", "🐯", "🐻"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return emojis[Math.abs(hash) % emojis.length];
};

// Stat Widget Component
function StatWidget({
  widget,
  stats,
  onRemove,
}: {
  widget: Widget;
  stats: StatsData | null;
  onRemove: () => void;
}) {
  const config = widgetConfigs[widget.type];
  const colors = getColorClasses(config.color);
  const [showMenu, setShowMenu] = useState(false);

  const getValue = () => {
    if (!stats) return "—";
    switch (widget.type) {
      case "total-trades": return stats.totalTrades.toLocaleString();
      case "open-orders": return stats.openOrders;
      case "volume-24h": return stats.volume24h >= 1000000 ? `$${(stats.volume24h / 1000000).toFixed(2)}M` : `$${(stats.volume24h / 1000).toFixed(1)}k`;
      case "active-merchants": return stats.activeMerchants;
      case "escrow-locked": return `$${(stats.escrowLocked / 1000).toFixed(1)}k`;
      case "disputes": return stats.disputes;
      case "success-rate": return `${stats.successRate.toFixed(1)}%`;
      case "avg-time": return `${stats.avgTime.toFixed(1)}m`;
      case "revenue": return `$${(stats.revenue / 1000).toFixed(1)}k`;
      case "users-online": return stats.totalUsers.toLocaleString();
      default: return "—";
    }
  };

  const getChange = () => {
    if (!stats) return 0;
    switch (widget.type) {
      case "total-trades": return stats.totalTradesChange;
      case "volume-24h": return stats.volume24hChange;
      default: return 0;
    }
  };

  const change = getChange();
  const isPositive = change > 0;
  const isNegative = change < 0;
  const invertedMetrics = ["disputes", "avg-time"];
  const isGood = invertedMetrics.includes(widget.type) ? isNegative : isPositive;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={`relative group bg-[#0d0d0d] rounded-xl border ${colors.border} p-4 hover:border-white/[0.12] transition-all`}
    >
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.04] rounded-md transition-colors">
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

      <div className="flex items-center gap-2 mb-3">
        <div className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center ${colors.icon}`}>{config.icon}</div>
        <span className="text-xs text-gray-500">{config.title}</span>
      </div>

      <div className="flex items-end justify-between">
        <p className="text-2xl font-bold">{getValue()}</p>
        {change !== 0 && (
          <div className={`flex items-center gap-0.5 ${isGood ? "text-emerald-400" : "text-red-400"}`}>
            {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            <span className="text-[11px] font-medium">{Math.abs(change).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Top Merchants Widget
function TopMerchantsWidget({ merchants, onRemove }: { merchants: ApiMerchant[]; onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="relative group bg-[#0d0d0d] rounded-xl border border-amber-500/20 p-4 hover:border-white/[0.12] transition-all">
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.04] rounded-md transition-colors">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl z-10">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400"><Crown className="w-4 h-4" /></div>
        <div>
          <span className="text-sm font-semibold">Top Merchants</span>
          <p className="text-[10px] text-gray-500">By volume</p>
        </div>
      </div>

      <div className="space-y-2">
        {merchants.length > 0 ? merchants.slice(0, 5).map((merchant, i) => (
          <div key={merchant.id} className="flex items-center gap-3 p-2.5 bg-[#151515] rounded-lg border border-white/[0.04] hover:border-white/[0.08] transition-colors">
            <div className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-semibold ${i === 0 ? "bg-amber-500/20 text-amber-400" : i === 1 ? "bg-gray-500/20 text-gray-400" : i === 2 ? "bg-amber-700/20 text-amber-600" : "bg-[#1a1a1a] text-gray-600"}`}>{i + 1}</div>
            <div className="w-8 h-8 rounded-lg bg-[#1f1f1f] flex items-center justify-center text-lg">{merchant.emoji}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium truncate">{merchant.name}</p>
                {merchant.rating > 0 && (
                  <div className="flex items-center gap-0.5 text-amber-400">
                    <Star className="w-2.5 h-2.5 fill-current" />
                    <span className="text-[10px]">{merchant.rating.toFixed(2)}</span>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-gray-500">{merchant.trades} trades</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold">${merchant.volume >= 1000 ? `${(merchant.volume / 1000).toFixed(0)}k` : merchant.volume.toFixed(0)}</p>
            </div>
          </div>
        )) : (
          <div className="text-center py-6 text-gray-500 text-xs">No merchants found</div>
        )}
      </div>
    </motion.div>
  );
}

// Live Orders Widget
function LiveOrdersWidget({ orders, onRemove }: { orders: ApiOrder[]; onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "active" | "completing">("all");
  const [localOrders, setLocalOrders] = useState(orders);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setLocalOrders(orders);
  }, [orders]);

  // Update timers every second
  useEffect(() => {
    const interval = setInterval(() => {
      setLocalOrders(prev => prev.map(order => {
        const expiresAt = new Date(order.expiresAt);
        const now = new Date();
        const expiresIn = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
        return { ...order, expiresIn };
      }));
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
    <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="relative group bg-[#0d0d0d] rounded-xl border border-blue-500/20 p-4 hover:border-white/[0.12] transition-all">
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.04] rounded-md transition-colors">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400"><Clock className="w-4 h-4" /></div>
          <div>
            <span className="text-sm font-semibold">Live Orders</span>
            <p className="text-[10px] text-gray-500">Real-time feed</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <motion.div className="w-2 h-2 rounded-full bg-blue-500" animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
          <span className="text-[10px] text-blue-400">{localOrders.length} active</span>
        </div>
      </div>

      <div className="flex gap-1 mb-3 bg-[#151515] rounded-lg p-1">
        {(["all", "pending", "active", "completing"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`flex-1 px-2 py-1 text-[10px] font-medium rounded-md transition-all ${filter === f ? "bg-blue-500/20 text-blue-400" : "text-gray-500 hover:text-gray-300"}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {filteredOrders.length > 0 ? filteredOrders.map((order) => {
            const expiresIn = mounted ? Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - Date.now()) / 1000)) : 0;
            return (
              <motion.div key={order.id} layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex items-center gap-3 p-2.5 bg-[#151515] rounded-lg border border-white/[0.04] hover:border-white/[0.08] transition-colors">
                <div className="flex items-center -space-x-2">
                  <div className="w-7 h-7 rounded-full bg-[#1f1f1f] flex items-center justify-center text-sm border-2 border-[#151515] z-10">{getUserEmoji(order.user)}</div>
                  <div className="w-7 h-7 rounded-full bg-[#1f1f1f] flex items-center justify-center text-sm border-2 border-[#151515]">{getUserEmoji(order.merchant)}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-gray-300">{order.orderNumber}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${getStatusColor(order.status)}`}>{getStatusLabel(order.status)}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-500">
                    <span className="truncate">{order.user}</span>
                    <span>→</span>
                    <span className="truncate">{order.merchant}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold">${order.amount.toLocaleString()}</p>
                  <p className={`text-[10px] font-mono ${expiresIn < 60 ? "text-red-400" : "text-gray-500"}`}>
                    {mounted ? `${Math.floor(expiresIn / 60)}:${(expiresIn % 60).toString().padStart(2, "0")}` : "--:--"}
                  </p>
                </div>
              </motion.div>
            );
          }) : (
            <div className="text-center py-6 text-gray-500 text-xs">No orders found</div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// Big Transactions Widget
function BigTransactionsWidget({ orders, onRemove }: { orders: ApiOrder[]; onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    const date = new Date(dateStr);
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="relative group bg-[#0d0d0d] rounded-xl border border-purple-500/20 p-4 hover:border-white/[0.12] transition-all">
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.04] rounded-md transition-colors">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400"><Zap className="w-4 h-4" /></div>
          <div>
            <span className="text-sm font-semibold">Big Transactions</span>
            <p className="text-[10px] text-gray-500">$5,000+ trades</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-purple-400">${(totalVolume / 1000).toFixed(0)}k</p>
          <p className="text-[10px] text-gray-500">+${totalFees.toFixed(0)} fees</p>
        </div>
      </div>

      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {bigOrders.length > 0 ? bigOrders.map((order, i) => (
          <motion.div key={order.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className={`flex items-center gap-3 p-3 bg-[#151515] rounded-lg border transition-colors ${order.status !== "completed" && order.status !== "pending" ? "border-amber-500/20 hover:border-amber-500/30" : "border-white/[0.04] hover:border-white/[0.08]"}`}>
            <div className="flex items-center -space-x-2">
              <div className="w-8 h-8 rounded-full bg-[#1f1f1f] flex items-center justify-center text-base border-2 border-[#151515] z-10">{getUserEmoji(order.user)}</div>
              <div className="w-8 h-8 rounded-full bg-[#1f1f1f] flex items-center justify-center text-base border-2 border-[#151515]">{getUserEmoji(order.merchant)}</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium">{order.orderNumber}</span>
                {getStatusBadge(order.status)}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                <span className="truncate">{order.user}</span>
                <span>→</span>
                <span className="truncate">{order.merchant}</span>
                <span className="text-gray-600">•</span>
                <span className="text-gray-600">{formatTimeAgo(order.createdAt)}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold">${order.amount.toLocaleString()}</p>
              <p className="text-[10px] text-emerald-400">+${(order.amount * 0.005).toFixed(0)} fee</p>
            </div>
          </motion.div>
        )) : (
          <div className="text-center py-6 text-gray-500 text-xs">No big transactions found</div>
        )}
      </div>

      {bigOrders.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between">
          <span className="text-[10px] text-gray-500">{bigOrders.length} big transactions</span>
          <span className="text-[10px] text-emerald-400 font-medium">+${totalFees.toFixed(0)} earned</span>
        </div>
      )}
    </motion.div>
  );
}

// Recent Activity Widget
function RecentActivityWidget({ activities, onRemove }: { activities: ApiActivity[]; onRemove: () => void }) {
  const [showMenu, setShowMenu] = useState(false);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success": return <CheckCircle className="w-3 h-3 text-emerald-400" />;
      case "warning": return <AlertCircle className="w-3 h-3 text-amber-400" />;
      case "error": return <XCircle className="w-3 h-3 text-red-400" />;
      default: return <Activity className="w-3 h-3 text-gray-400" />;
    }
  };

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="relative group bg-[#0d0d0d] rounded-xl border border-white/[0.08] p-4 hover:border-white/[0.12] transition-all">
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-white/[0.04] rounded-md transition-colors">
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-500" />
        </button>
        <AnimatePresence>
          {showMenu && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute top-full right-0 mt-1 w-32 bg-[#1a1a1a] rounded-lg border border-white/[0.08] shadow-xl z-10">
              <button onClick={() => { onRemove(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.04] flex items-center gap-2">
                <X className="w-3 h-3" /> Remove
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center text-gray-400"><Activity className="w-4 h-4" /></div>
          <div>
            <span className="text-sm font-semibold">Recent Activity</span>
            <p className="text-[10px] text-gray-500">Live platform events</p>
          </div>
        </div>
        <motion.div className="w-2 h-2 rounded-full bg-emerald-500" animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity }} />
      </div>

      <div className="space-y-2 max-h-[280px] overflow-y-auto">
        {activities.length > 0 ? activities.map((activity) => (
          <div key={activity.id} className="flex items-center gap-3 p-2.5 bg-[#151515] rounded-lg border border-white/[0.04]">
            <div className="w-6 h-6 rounded-md bg-[#1a1a1a] flex items-center justify-center">{getStatusIcon(activity.status)}</div>
            <div className="flex-1 min-w-0"><p className="text-xs text-gray-300 truncate">{activity.message}</p></div>
            <span className="text-[10px] text-gray-600 shrink-0">{activity.time}</span>
          </div>
        )) : (
          <div className="text-center py-6 text-gray-500 text-xs">No recent activity</div>
        )}
      </div>
    </motion.div>
  );
}

// Add Widget Modal
function AddWidgetModal({ show, onClose, onAdd, existingWidgets }: { show: boolean; onClose: () => void; onAdd: (type: WidgetType) => void; existingWidgets: WidgetType[] }) {
  const availableWidgets = (Object.keys(widgetConfigs) as WidgetType[]).filter((type) => !existingWidgets.includes(type));

  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50" onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md">
            <div className="bg-[#151515] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.08] flex items-center justify-center"><Plus className="w-5 h-5 text-white" /></div>
                  <div>
                    <h2 className="text-sm font-semibold">Add Widget</h2>
                    <p className="text-[11px] text-gray-500">Choose a widget to add</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"><X className="w-4 h-4 text-gray-500" /></button>
              </div>
              <div className="p-4 max-h-[400px] overflow-y-auto">
                {availableWidgets.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {availableWidgets.map((type) => {
                      const config = widgetConfigs[type];
                      const colors = getColorClasses(config.color);
                      return (
                        <motion.button key={type} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { onAdd(type); onClose(); }} className={`p-3 bg-[#1a1a1a] rounded-xl border ${colors.border} hover:border-white/[0.15] transition-all text-left`}>
                          <div className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center ${colors.icon} mb-2`}>{config.icon}</div>
                          <p className="text-xs font-medium mb-0.5">{config.title}</p>
                          <p className="text-[10px] text-gray-500">{config.description}</p>
                        </motion.button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8"><p className="text-sm text-gray-500">All widgets are already added</p></div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default function AdminConsolePage() {
  const { playSound } = useSounds();
  const { setActor, subscribe, unsubscribe, isConnected } = usePusher();
  const [widgets, setWidgets] = useState<Widget[]>(initialWidgets);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mounted, setMounted] = useState(false);

  // API data states
  const [stats, setStats] = useState<StatsData | null>(null);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [merchants, setMerchants] = useState<ApiMerchant[]>([]);
  const [activities, setActivities] = useState<ApiActivity[]>([]);

  // Set admin actor for Pusher
  useEffect(() => {
    setActor('merchant', 'admin');
  }, [setActor]);

  // Fix hydration mismatch for date formatting
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch all data
  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [statsRes, ordersRes, merchantsRes, activityRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/orders?status=pending,accepted,escrowed,payment_sent,payment_confirmed'),
        fetch('/api/admin/merchants?sort=volume&limit=10'),
        fetch('/api/admin/activity?limit=15'),
      ]);

      const [statsData, ordersData, merchantsData, activityData] = await Promise.all([
        statsRes.json(),
        ordersRes.json(),
        merchantsRes.json(),
        activityRes.json(),
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

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to real-time updates via Pusher
  useEffect(() => {
    if (!isConnected) return;

    // Subscribe to a global admin channel for all order updates
    const channel = subscribe('private-admin');
    if (!channel) return;

    const handleOrderCreated = () => {
      fetchData();
      playSound('notification');
    };

    const handleOrderUpdated = () => {
      fetchData();
    };

    channel.bind('order:created', handleOrderCreated);
    channel.bind('order:status-updated', handleOrderUpdated);

    return () => {
      channel.unbind('order:created', handleOrderCreated);
      channel.unbind('order:status-updated', handleOrderUpdated);
      unsubscribe('private-admin');
    };
  }, [isConnected, subscribe, unsubscribe, fetchData, playSound]);

  // Fallback polling every 30 seconds (in case Pusher events are missed)
  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const addWidget = (type: WidgetType) => {
    const largeWidgetTypes: WidgetType[] = ["top-merchants", "recent-activity", "live-orders", "big-transactions"];
    const newWidget: Widget = { id: `w${Date.now()}`, type, size: largeWidgetTypes.includes(type) ? "lg" : "sm", visible: true };
    setWidgets([...widgets, newWidget]);
  };

  const removeWidget = (id: string) => setWidgets(widgets.filter((w) => w.id !== id));

  const existingWidgetTypes = widgets.map((w) => w.type);
  const smallWidgets = widgets.filter((w) => w.size === "sm" && w.visible);
  const largeWidgets = widgets.filter((w) => w.size === "lg" && w.visible);

  // Sidebar stats from API
  const sidebarStats = [
    { label: "Platform Uptime", value: "99.97%", icon: <Zap className="w-3.5 h-3.5" />, color: "emerald" },
    { label: "API Latency", value: "42ms", icon: <Activity className="w-3.5 h-3.5" />, color: "blue" },
    { label: "Total Merchants", value: stats?.totalMerchants?.toString() || "0", icon: <Shield className="w-3.5 h-3.5" />, color: "purple" },
    { label: "Total Users", value: stats?.totalUsers?.toLocaleString() || "0", icon: <Users className="w-3.5 h-3.5" />, color: "white" },
    { label: "Active Disputes", value: stats?.disputes?.toString() || "0", icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "red" },
    { label: "Success Rate", value: stats?.successRate ? `${stats.successRate.toFixed(1)}%` : "0%", icon: <CheckCircle className="w-3.5 h-3.5" />, color: "emerald" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[600px] h-[400px] bg-white/[0.02] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[500px] h-[300px] bg-emerald-500/[0.015] rounded-full blur-[150px]" />
        <div className="absolute top-1/3 right-1/4 w-[400px] h-[400px] bg-purple-500/[0.01] rounded-full blur-[150px]" />
      </div>

      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="px-4 h-12 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg border border-white/20 flex items-center justify-center text-white font-bold text-xs">B</div>
            <span className="text-sm font-semibold hidden sm:block">Admin</span>
          </div>

          <nav className="flex items-center gap-1 ml-3">
            <Link href="/admin" className="px-2.5 py-1 text-[11px] font-medium bg-white/[0.08] rounded-md text-white">Console</Link>
            <Link href="/merchant" className="px-2.5 py-1 text-[11px] font-medium text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-md transition-all">Merchant View</Link>
          </nav>

          <div className="flex-1" />

          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span>Last updated: {mounted ? lastRefresh.toLocaleTimeString() : '--:--:--'}</span>
            <motion.button whileTap={{ scale: 0.9 }} onClick={fetchData} disabled={isRefreshing} className="p-1.5 hover:bg-white/[0.04] rounded-md transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </motion.button>
          </div>

          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setShowAddWidget(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-black rounded-lg text-[11px] font-bold hover:bg-white/90 transition-all">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span className="hidden sm:inline">Add Widget</span>
          </motion.button>

          <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <motion.div className="w-1.5 h-1.5 rounded-full bg-emerald-500" animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity }} />
            <span className="text-[10px] text-emerald-400 font-medium">Live</span>
          </div>

          <div className="flex items-center gap-2 pl-2 border-l border-white/[0.08]">
            <div className="w-7 h-7 rounded-full border border-white/20 flex items-center justify-center text-sm">⚡</div>
            <div className="hidden sm:block">
              <p className="text-[11px] font-medium">Admin</p>
              <p className="text-[9px] text-gray-500">Super</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Stats Sidebar */}
        <aside className="hidden lg:flex w-56 border-r border-white/[0.04] bg-[#0d0d0d]/30 flex-col">
          <div className="p-4 border-b border-white/[0.04]">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">System Stats</h3>
          </div>
          <div className="flex-1 p-3 space-y-2 overflow-y-auto">
            {sidebarStats.map((stat) => {
              const colors = getColorClasses(stat.color);
              return (
                <div key={stat.label} className="p-3 bg-[#151515] rounded-lg border border-white/[0.04] hover:border-white/[0.08] transition-colors">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-6 h-6 rounded-md ${colors.bg} flex items-center justify-center ${colors.icon}`}>{stat.icon}</div>
                    <span className="text-[10px] text-gray-500">{stat.label}</span>
                  </div>
                  <p className="text-lg font-bold">{stat.value}</p>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t border-white/[0.04]">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 px-1">Quick Actions</p>
            <div className="space-y-1">
              <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-all">
                <Settings className="w-3.5 h-3.5" /> Settings <ChevronRight className="w-3 h-3 ml-auto" />
              </button>
              <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-all">
                <Shield className="w-3.5 h-3.5" /> Merchants <ChevronRight className="w-3 h-3 ml-auto" />
              </button>
              <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-all">
                <AlertTriangle className="w-3.5 h-3.5" /> Disputes <ChevronRight className="w-3 h-3 ml-auto" />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 overflow-auto relative z-10">
          <div className="mb-6">
            <h1 className="text-xl font-bold">Admin Console</h1>
            <p className="text-xs text-gray-500 mt-0.5">Real-time platform overview</p>
          </div>

          {/* Small Widgets Grid */}
          {smallWidgets.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
              <AnimatePresence mode="popLayout">
                {smallWidgets.map((widget) => (
                  <StatWidget key={widget.id} widget={widget} stats={stats} onRemove={() => removeWidget(widget.id)} />
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* Large Widgets Grid */}
          {largeWidgets.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AnimatePresence mode="popLayout">
                {largeWidgets.map((widget) => {
                  if (widget.type === "live-orders") return <LiveOrdersWidget key={widget.id} orders={orders} onRemove={() => removeWidget(widget.id)} />;
                  if (widget.type === "big-transactions") return <BigTransactionsWidget key={widget.id} orders={orders} onRemove={() => removeWidget(widget.id)} />;
                  if (widget.type === "top-merchants") return <TopMerchantsWidget key={widget.id} merchants={merchants} onRemove={() => removeWidget(widget.id)} />;
                  if (widget.type === "recent-activity") return <RecentActivityWidget key={widget.id} activities={activities} onRemove={() => removeWidget(widget.id)} />;
                  return null;
                })}
              </AnimatePresence>
            </div>
          )}

          {/* Empty State */}
          {widgets.filter((w) => w.visible).length === 0 && (
            <div className="flex flex-col items-center justify-center h-[60vh]">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-4"><BarChart3 className="w-8 h-8 text-gray-600" /></div>
              <h3 className="text-lg font-semibold mb-1">No Widgets</h3>
              <p className="text-sm text-gray-500 mb-4">Add widgets to start monitoring</p>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setShowAddWidget(true)} className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg text-sm font-bold">
                <Plus className="w-4 h-4" /> Add Widget
              </motion.button>
            </div>
          )}
        </main>
      </div>

      <AddWidgetModal show={showAddWidget} onClose={() => setShowAddWidget(false)} onAdd={addWidget} existingWidgets={existingWidgetTypes} />
    </div>
  );
}
