"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Activity,
  XCircle,
  CheckCircle,
  Timer,
  ArrowUpRight,
  History,
} from "lucide-react";
import Link from "next/link";

// Types
interface ClosedOrder {
  id: string;
  orderNumber: string;
  type: "buy" | "sell";
  status: "expired" | "cancelled" | "disputed";
  cryptoAmount: number;
  fiatAmount: number;
  paymentMethod: "bank" | "cash";
  createdAt: Date;
  closedAt: Date;
  reason: string;
  extensionCount: number;
  maxExtensions: number;
}

type StatusFilter = "all" | "expired" | "cancelled" | "disputed";
type TypeFilter = "all" | "buy" | "sell";

function getReasonForStatus(status: string, extensionCount: number, maxExtensions: number): string {
  switch (status) {
    case 'expired':
      return 'No merchant accepted';
    case 'cancelled':
      if (extensionCount >= maxExtensions) {
        return `Cancelled after ${extensionCount} extensions`;
      }
      return 'Extension declined';
    case 'disputed':
      return `Disputed after ${extensionCount} extension(s)`;
    default:
      return 'Order closed';
  }
}

export default function ConsolePage() {
  const [closedOrders, setClosedOrders] = useState<ClosedOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalOrders: 0,
    completedOrders: 0,
    expiredOrders: 0,
    cancelledOrders: 0,
    disputedOrders: 0,
    totalVolume: 0,
    successRate: 0,
  });

  // Fetch closed orders from API (expired, cancelled, disputed)
  useEffect(() => {
    const fetchClosedOrders = async () => {
      setIsLoading(true);
      try {
        // Fetch all closed order types in parallel
        const [expiredRes, cancelledRes, disputedRes] = await Promise.all([
          fetch('/api/orders?status=expired'),
          fetch('/api/orders?status=cancelled'),
          fetch('/api/orders?status=disputed'),
        ]);

        const mapOrder = (o: Record<string, unknown>, status: "expired" | "cancelled" | "disputed"): ClosedOrder => ({
          id: o.id as string,
          orderNumber: o.order_number as string || `ORD-${(o.id as string).slice(0, 6)}`,
          type: o.type as "buy" | "sell",
          status,
          cryptoAmount: o.crypto_amount as number,
          fiatAmount: o.fiat_amount as number,
          paymentMethod: o.payment_method as "bank" | "cash",
          createdAt: new Date(o.created_at as string),
          closedAt: new Date(o.updated_at as string || o.expires_at as string || o.created_at as string),
          extensionCount: (o.extension_count as number) || 0,
          maxExtensions: (o.max_extensions as number) || 3,
          reason: getReasonForStatus(status, (o.extension_count as number) || 0, (o.max_extensions as number) || 3),
        });

        const allOrders: ClosedOrder[] = [];
        let expiredCount = 0, cancelledCount = 0, disputedCount = 0;

        if (expiredRes.ok) {
          const data = await expiredRes.json();
          if (data.success && data.data) {
            const orders = data.data.map((o: Record<string, unknown>) => mapOrder(o, 'expired'));
            allOrders.push(...orders);
            expiredCount = orders.length;
          }
        }

        if (cancelledRes.ok) {
          const data = await cancelledRes.json();
          if (data.success && data.data) {
            const orders = data.data.map((o: Record<string, unknown>) => mapOrder(o, 'cancelled'));
            allOrders.push(...orders);
            cancelledCount = orders.length;
          }
        }

        if (disputedRes.ok) {
          const data = await disputedRes.json();
          if (data.success && data.data) {
            const orders = data.data.map((o: Record<string, unknown>) => mapOrder(o, 'disputed'));
            allOrders.push(...orders);
            disputedCount = orders.length;
          }
        }

        // Sort by closedAt descending
        allOrders.sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime());
        setClosedOrders(allOrders);

        // Update stats
        setStats(prev => ({
          ...prev,
          expiredOrders: expiredCount,
          cancelledOrders: cancelledCount,
          disputedOrders: disputedCount,
        }));

      } catch (error) {
        console.error('Failed to fetch closed orders:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchClosedOrders();
  }, []);

  const filteredOrders = closedOrders.filter(o => {
    const statusMatch = statusFilter === "all" || o.status === statusFilter;
    const typeMatch = typeFilter === "all" || o.type === typeFilter;
    return statusMatch && typeMatch;
  });

  const retryOrder = async (order: ClosedOrder) => {
    // Navigate to home with prefilled order params
    window.location.href = `/?type=${order.type}&amount=${order.cryptoAmount}&method=${order.paymentMethod}`;
  };

  const dismissOrder = (orderId: string) => {
    setClosedOrders(prev => prev.filter(o => o.id !== orderId));
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);

    if (hours > 24) {
      return date.toLocaleDateString();
    }
    if (hours > 0) {
      return `${hours}h ${mins}m ago`;
    }
    return `${mins}m ago`;
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[600px] h-[400px] bg-orange-500/[0.03] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[500px] h-[300px] bg-orange-500/[0.02] rounded-full blur-[150px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="px-4 h-14 flex items-center gap-4">
          <Link href="/" className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-neutral-400" />
          </Link>
          <div>
            <h1 className="text-sm font-semibold">Console</h1>
            <p className="text-[10px] text-neutral-500">Order Analytics & Timeouts</p>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => window.location.reload()}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-neutral-400" />
          </button>
        </div>
      </header>

      <main className="relative z-10 p-4 pb-20">
        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setStatusFilter("expired")}
            className={`glass-card rounded-xl p-4 cursor-pointer transition-all ${statusFilter === 'expired' ? 'ring-1 ring-amber-500/50' : ''}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Timer className="w-4 h-4 text-amber-400" />
              </div>
            </div>
            <p className="text-2xl font-bold text-amber-400">{stats.expiredOrders}</p>
            <p className="text-[11px] text-neutral-500">Expired</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            onClick={() => setStatusFilter("cancelled")}
            className={`glass-card rounded-xl p-4 cursor-pointer transition-all ${statusFilter === 'cancelled' ? 'ring-1 ring-red-500/50' : ''}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                <XCircle className="w-4 h-4 text-red-400" />
              </div>
            </div>
            <p className="text-2xl font-bold text-red-400">{stats.cancelledOrders}</p>
            <p className="text-[11px] text-neutral-500">Cancelled</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            onClick={() => setStatusFilter("disputed")}
            className={`glass-card rounded-xl p-4 cursor-pointer transition-all ${statusFilter === 'disputed' ? 'ring-1 ring-orange-500/50' : ''}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-orange-400" />
              </div>
            </div>
            <p className="text-2xl font-bold text-orange-400">{stats.disputedOrders}</p>
            <p className="text-[11px] text-neutral-500">Disputed</p>
          </motion.div>
        </div>

        {/* Total Closed Orders */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          onClick={() => setStatusFilter("all")}
          className={`glass-card rounded-xl p-4 mb-6 cursor-pointer transition-all ${statusFilter === 'all' ? 'ring-1 ring-white/20' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-neutral-500/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-neutral-400" />
              </div>
              <div>
                <p className="text-[11px] text-neutral-500 uppercase tracking-wide">Total Closed</p>
                <p className="text-xl font-bold">{closedOrders.length}</p>
              </div>
            </div>
            <span className="text-[11px] text-neutral-500">
              {statusFilter === 'all' ? 'Showing all' : `Filtered: ${statusFilter}`}
            </span>
          </div>
        </motion.div>

        {/* Closed Orders Section */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-neutral-400" />
              <h2 className="text-sm font-semibold">Closed Orders</h2>
              <span className="px-2 py-0.5 bg-neutral-500/10 rounded-full text-[10px] text-neutral-400 font-medium">
                {filteredOrders.length}
              </span>
            </div>
          </div>

          {/* Type Filter Tabs */}
          <div className="flex gap-2 mb-4">
            {(["all", "buy", "sell"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  typeFilter === f
                    ? "bg-orange-500 text-black"
                    : "bg-neutral-900 text-neutral-400 hover:text-white"
                }`}
              >
                {f === "all" ? "All Types" : f === "buy" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>

          {/* Orders List */}
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {isLoading ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-8"
                >
                  <RefreshCw className="w-6 h-6 text-neutral-500 animate-spin mx-auto mb-3" />
                  <p className="text-sm text-neutral-500">Loading orders...</p>
                </motion.div>
              ) : filteredOrders.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-8"
                >
                  <div className="w-12 h-12 rounded-full bg-neutral-900 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle className="w-6 h-6 text-neutral-600" />
                  </div>
                  <p className="text-sm text-neutral-500">No closed orders</p>
                  <p className="text-[12px] text-neutral-600 mt-1">
                    {statusFilter === 'all'
                      ? 'All your orders completed successfully'
                      : `No ${statusFilter} orders found`}
                  </p>
                </motion.div>
              ) : (
                filteredOrders.map((order, i) => (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -100 }}
                    transition={{ delay: Math.min(i * 0.05, 0.3) }}
                    className="glass-card rounded-xl p-4"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          order.type === "buy" ? "bg-emerald-500/10" : "bg-orange-500/10"
                        }`}>
                          {order.type === "buy" ? (
                            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4 text-orange-400 rotate-180" />
                          )}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium">
                            {order.type === "buy" ? "Buy" : "Sell"} {order.cryptoAmount} USDC
                          </p>
                          <p className="text-[11px] text-neutral-500">{order.orderNumber}</p>
                        </div>
                      </div>
                      {/* Status Badge */}
                      <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${
                        order.status === 'expired'
                          ? 'bg-amber-500/10'
                          : order.status === 'cancelled'
                            ? 'bg-red-500/10'
                            : 'bg-orange-500/10'
                      }`}>
                        {order.status === 'expired' ? (
                          <Timer className="w-3 h-3 text-amber-400" />
                        ) : order.status === 'cancelled' ? (
                          <XCircle className="w-3 h-3 text-red-400" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-orange-400" />
                        )}
                        <span className={`text-[10px] font-medium capitalize ${
                          order.status === 'expired'
                            ? 'text-amber-400'
                            : order.status === 'cancelled'
                              ? 'text-red-400'
                              : 'text-orange-400'
                        }`}>
                          {order.status}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[12px] mb-3 pb-3 border-b border-neutral-800">
                      <span className="text-neutral-500">Amount</span>
                      <span className="font-medium">د.إ {order.fiatAmount.toFixed(2)}</span>
                    </div>

                    <div className="flex items-center justify-between text-[12px] mb-3">
                      <span className="text-neutral-500">Payment</span>
                      <span className="capitalize">{order.paymentMethod}</span>
                    </div>

                    <div className="flex items-center justify-between text-[12px] mb-3">
                      <span className="text-neutral-500">Reason</span>
                      <span className="text-neutral-400">{order.reason}</span>
                    </div>

                    {order.extensionCount > 0 && (
                      <div className="flex items-center justify-between text-[12px] mb-3">
                        <span className="text-neutral-500">Extensions Used</span>
                        <span className="text-neutral-400">{order.extensionCount} / {order.maxExtensions}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[12px] mb-4">
                      <span className="text-neutral-500">Closed</span>
                      <span className="text-neutral-400">{formatDate(order.closedAt)}</span>
                    </div>

                    {/* Only show retry for expired/cancelled, not disputed */}
                    {order.status !== 'disputed' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => retryOrder(order)}
                          className="flex-1 py-2.5 rounded-xl bg-orange-500 text-black text-[13px] font-medium press-effect"
                        >
                          Retry Order
                        </button>
                        <button
                          onClick={() => dismissOrder(order.id)}
                          className="px-4 py-2.5 rounded-xl bg-neutral-900 text-neutral-400 text-[13px] font-medium"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}

                    {/* For disputed orders, show contact support */}
                    {order.status === 'disputed' && (
                      <div className="flex gap-2">
                        <button
                          className="flex-1 py-2.5 rounded-xl bg-orange-500/20 text-orange-400 text-[13px] font-medium"
                        >
                          View Dispute
                        </button>
                        <button
                          onClick={() => dismissOrder(order.id)}
                          className="px-4 py-2.5 rounded-xl bg-neutral-900 text-neutral-400 text-[13px] font-medium"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Quick Links */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-6"
        >
          <h3 className="text-[12px] text-neutral-500 uppercase tracking-wide mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/" className="glass-card rounded-xl p-4 hover:bg-white/5 transition-colors">
              <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center mb-2">
                <ArrowUpRight className="w-4 h-4 text-orange-400" />
              </div>
              <p className="text-[13px] font-medium">New Trade</p>
              <p className="text-[11px] text-neutral-500">Start a new order</p>
            </Link>
            <Link href="/" className="glass-card rounded-xl p-4 hover:bg-white/5 transition-colors">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-2">
                <History className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-[13px] font-medium">Order History</p>
              <p className="text-[11px] text-neutral-500">View all orders</p>
            </Link>
          </div>
        </motion.div>
      </main>

      {/* Bottom Safe Area */}
      <div className="h-20" />

      <style jsx>{`
        .glass-card {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .press-effect:active {
          transform: scale(0.97);
        }
      `}</style>
    </div>
  );
}
