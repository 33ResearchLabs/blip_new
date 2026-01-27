"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Check,
  Shield,
  Bell,
  Wallet,
  Activity,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Users,
  Zap,
  Target,
  Award,
  Star,
} from "lucide-react";
import Link from "next/link";

// Mock data
const weeklyData = [
  { day: "Mon", trades: 12, volume: 4200, earnings: 32 },
  { day: "Tue", trades: 18, volume: 6800, earnings: 51 },
  { day: "Wed", trades: 15, volume: 5500, earnings: 41 },
  { day: "Thu", trades: 22, volume: 8200, earnings: 62 },
  { day: "Fri", trades: 28, volume: 11000, earnings: 83 },
  { day: "Sat", trades: 20, volume: 7500, earnings: 56 },
  { day: "Sun", trades: 16, volume: 6000, earnings: 45 },
];

const recentTrades = [
  { id: 1, user: "anon_fox", amount: 1200, profit: 9, time: "2m ago", rating: 5 },
  { id: 2, user: "degen_ape", amount: 800, profit: 6, time: "15m ago", rating: 5 },
  { id: 3, user: "sol_maxi", amount: 2500, profit: 19, time: "32m ago", rating: 4 },
  { id: 4, user: "whale_69", amount: 500, profit: 4, time: "1h ago", rating: 5 },
  { id: 5, user: "ser_pump", amount: 3200, profit: 24, time: "2h ago", rating: 5 },
];

const topUsers = [
  { name: "whale_69", trades: 45, volume: 125000, emoji: "🐋" },
  { name: "ser_pump", trades: 38, volume: 98000, emoji: "🔥" },
  { name: "anon_fox", trades: 32, volume: 76000, emoji: "🦊" },
  { name: "gm_alice", trades: 28, volume: 62000, emoji: "💎" },
  { name: "degen_ape", trades: 24, volume: 54000, emoji: "🦧" },
];

interface MerchantInfo {
  id: string;
  display_name: string;
  business_name: string;
  rating?: number;
}

export default function AnalyticsPage() {
  const [timeframe, setTimeframe] = useState<"7d" | "30d" | "all">("7d");
  const [merchantInfo, setMerchantInfo] = useState<MerchantInfo | null>(null);

  // Load merchant info from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('blip_merchant');
    if (saved) {
      try {
        setMerchantInfo(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse merchant info:', e);
      }
    }
  }, []);

  const maxVolume = Math.max(...weeklyData.map(d => d.volume));
  const totalTrades = weeklyData.reduce((sum, d) => sum + d.trades, 0);
  const totalVolume = weeklyData.reduce((sum, d) => sum + d.volume, 0);
  const totalEarnings = weeklyData.reduce((sum, d) => sum + d.earnings, 0);
  const avgResponseTime = 45;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[600px] h-[400px] bg-[#ff6b35]/[0.02] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[500px] h-[300px] bg-emerald-500/[0.02] rounded-full blur-[150px]" />
      </div>

      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="px-4 h-14 flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#ff6b35] to-[#ff8c50] flex items-center justify-center text-black font-bold text-sm">
              B
            </div>
            <span className="text-sm font-semibold hidden sm:block">Merchant</span>
          </div>

          {/* Nav Links */}
          <nav className="flex items-center gap-1 ml-4">
            <Link
              href="/merchant"
              className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-all"
            >
              Console
            </Link>
            <Link
              href="/merchant/analytics"
              className="px-3 py-1.5 text-xs font-medium bg-white/[0.08] rounded-lg text-white"
            >
              Analytics
            </Link>
            <Link
              href="/merchant/settings"
              className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-lg transition-all"
            >
              Settings
            </Link>
          </nav>

          <div className="flex-1" />

          {/* Quick Stats */}
          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#151515] rounded-lg border border-white/[0.04]">
              <Wallet className="w-3.5 h-3.5 text-[#ff6b35]" />
              <span className="text-sm font-bold">$12,420</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-sm font-bold text-emerald-400">+$126</span>
              <span className="text-[10px] text-emerald-400/60">today</span>
            </div>
          </div>

          {/* Online Status */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <motion.div
              className="w-2 h-2 rounded-full bg-emerald-500"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <span className="text-[11px] text-emerald-400 font-medium">Online</span>
          </div>

          {/* Profile */}
          <div className="flex items-center gap-2 pl-3 border-l border-white/[0.08]">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#ff6b35] to-[#ff8c50] flex items-center justify-center text-sm">
              {merchantInfo?.display_name?.charAt(0)?.toUpperCase() || '🐋'}
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-medium">{merchantInfo?.display_name || merchantInfo?.business_name || 'Merchant'}</p>
              <p className="text-[10px] text-gray-500">{merchantInfo?.rating?.toFixed(2) || '5.00'}★</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 overflow-auto relative z-10">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Analytics</h1>
            <p className="text-xs text-gray-500 mt-0.5">Performance overview and insights</p>
          </div>

          {/* Timeframe Selector */}
          <div className="flex bg-[#151515] rounded-lg p-1 border border-white/[0.04]">
            {(["7d", "30d", "all"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  timeframe === tf
                    ? "bg-[#ff6b35] text-black"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {tf === "all" ? "All Time" : tf}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-[#0d0d0d] rounded-xl border border-white/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-[#ff6b35]/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-[#ff6b35]" />
              </div>
              <span className="text-xs text-gray-500">Total Trades</span>
            </div>
            <p className="text-2xl font-bold">{totalTrades}</p>
            <div className="flex items-center gap-1 mt-1">
              <ArrowUpRight className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-emerald-400">+12% vs last week</span>
            </div>
          </div>

          <div className="bg-[#0d0d0d] rounded-xl border border-white/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-xs text-gray-500">Volume</span>
            </div>
            <p className="text-2xl font-bold">${Math.round(totalVolume / 1000)}k</p>
            <div className="flex items-center gap-1 mt-1">
              <ArrowUpRight className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-emerald-400">+8% vs last week</span>
            </div>
          </div>

          <div className="bg-[#0d0d0d] rounded-xl border border-white/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Wallet className="w-4 h-4 text-amber-400" />
              </div>
              <span className="text-xs text-gray-500">Earnings</span>
            </div>
            <p className="text-2xl font-bold">${Math.round(totalEarnings)}</p>
            <div className="flex items-center gap-1 mt-1">
              <ArrowUpRight className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-emerald-400">+15% vs last week</span>
            </div>
          </div>

          <div className="bg-[#0d0d0d] rounded-xl border border-white/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Zap className="w-4 h-4 text-purple-400" />
              </div>
              <span className="text-xs text-gray-500">Avg Response</span>
            </div>
            <p className="text-2xl font-bold">{avgResponseTime}s</p>
            <div className="flex items-center gap-1 mt-1">
              <ArrowDownRight className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-emerald-400">-5s faster</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Volume Chart */}
          <div className="lg:col-span-2 bg-[#0d0d0d] rounded-xl border border-white/[0.04] p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Weekly Volume</h3>
              <div className="flex items-center gap-3 text-[10px] text-gray-500">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-[#ff6b35]" />
                  Volume
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  Trades
                </div>
              </div>
            </div>

            {/* Bar Chart */}
            <div className="h-48 flex items-end gap-2">
              {weeklyData.map((day, i) => (
                <div key={day.day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col items-center gap-1 h-40 justify-end">
                    {/* Volume Bar */}
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${(day.volume / maxVolume) * 100}%` }}
                      transition={{ delay: i * 0.05, duration: 0.4 }}
                      className="w-full bg-gradient-to-t from-[#ff6b35] to-[#ff8c50] rounded-t-md relative group"
                    >
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-[#1a1a1a] px-2 py-1 rounded text-[10px] whitespace-nowrap border border-white/[0.08]">
                        ${day.volume.toLocaleString()}
                      </div>
                    </motion.div>
                  </div>
                  <span className="text-[10px] text-gray-500">{day.day}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="bg-[#0d0d0d] rounded-xl border border-white/[0.04] p-4">
            <h3 className="text-sm font-semibold mb-4">Performance</h3>

            <div className="space-y-4">
              {/* Success Rate */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-gray-400">Success Rate</span>
                  <span className="text-sm font-bold text-emerald-400">98.2%</span>
                </div>
                <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: "98.2%" }}
                    transition={{ duration: 0.6 }}
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full"
                  />
                </div>
              </div>

              {/* Rating */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-gray-400">Average Rating</span>
                  <div className="flex items-center gap-1">
                    <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                    <span className="text-sm font-bold">4.92</span>
                  </div>
                </div>
                <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: "98.4%" }}
                    transition={{ duration: 0.6 }}
                    className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full"
                  />
                </div>
              </div>

              {/* Bond Utilization */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-gray-400">Bond Utilization</span>
                  <span className="text-sm font-bold">32%</span>
                </div>
                <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: "32%" }}
                    transition={{ duration: 0.6 }}
                    className="h-full bg-gradient-to-r from-[#ff6b35] to-[#ff8c50] rounded-full"
                  />
                </div>
              </div>

              {/* Disputes */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-gray-400">Disputes (30d)</span>
                  <span className="text-sm font-bold text-emerald-400">0</span>
                </div>
                <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                  <div className="h-full w-0 bg-red-500 rounded-full" />
                </div>
              </div>
            </div>

            {/* Tier Badge */}
            <div className="mt-6 p-3 bg-gradient-to-r from-[#ff6b35]/10 to-amber-500/10 rounded-lg border border-[#ff6b35]/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ff6b35] to-amber-500 flex items-center justify-center">
                  <Award className="w-5 h-5 text-black" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Tier 3 Merchant</p>
                  <p className="text-[10px] text-gray-500">847 trades · 4.92★</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          {/* Recent Trades */}
          <div className="bg-[#0d0d0d] rounded-xl border border-white/[0.04] p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Recent Trades</h3>
              <button className="text-[10px] text-[#ff6b35] hover:text-[#ff8c50] transition-colors">
                View all
              </button>
            </div>

            <div className="space-y-2">
              {recentTrades.map((trade) => (
                <div
                  key={trade.id}
                  className="flex items-center gap-3 p-2.5 bg-[#151515] rounded-lg border border-white/[0.04]"
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Check className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{trade.user}</p>
                    <p className="text-[10px] text-gray-500">${trade.amount.toLocaleString()} USDC</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-emerald-400">+${trade.profit}</p>
                    <p className="text-[10px] text-gray-600">{trade.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Users */}
          <div className="bg-[#0d0d0d] rounded-xl border border-white/[0.04] p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Top Users</h3>
              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                <Users className="w-3 h-3" />
                By volume
              </div>
            </div>

            <div className="space-y-2">
              {topUsers.map((user, i) => (
                <div
                  key={user.name}
                  className="flex items-center gap-3 p-2.5 bg-[#151515] rounded-lg border border-white/[0.04]"
                >
                  <div className="w-6 h-6 rounded-full bg-[#252525] flex items-center justify-center text-[10px] font-bold">
                    {i + 1}
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-[#1f1f1f] flex items-center justify-center text-lg">
                    {user.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{user.name}</p>
                    <p className="text-[10px] text-gray-500">{user.trades} trades</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold">${Math.round(user.volume / 1000)}k</p>
                    <p className="text-[10px] text-gray-600">volume</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
