'use client';

import { useState, useEffect } from 'react';
import { Zap, Clock, TrendingUp, ArrowRight, Loader2, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';

interface MempoolOrder {
  id: string;
  order_number: string;
  corridor_id: string;
  side: string;
  amount_usdt: number;
  ref_price_at_create: number;
  premium_bps_current: number;
  premium_bps_cap: number;
  bump_step_bps: number;
  current_offer_price: number;
  max_offer_price: number;
  expires_at: string;
  seconds_until_expiry: number;
  creator_username: string | null;
  creator_merchant_id: string | null;
  auto_bump_enabled: boolean;
  created_at: string;
}

interface MempoolWidgetProps {
  onSelectOrder?: (order: MempoolOrder) => void;
  selectedOrderId?: string | null;
}

export function MempoolWidget({ onSelectOrder, selectedOrderId }: MempoolWidgetProps) {
  const [orders, setOrders] = useState<MempoolOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    fetchOrders();

    if (autoRefresh) {
      const interval = setInterval(fetchOrders, 5000); // Refresh every 5s
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/mempool?type=orders&corridor_id=USDT_AED&limit=50');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setOrders(data.data.orders || []);
        }
      }
    } catch (error) {
      console.error('Failed to fetch mempool orders:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimeRemaining = (seconds: number): string => {
    if (seconds < 0) return 'EXPIRED';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getPriorityColor = (premiumBps: number): string => {
    if (premiumBps >= 200) return 'text-orange-500'; // High priority - gold
    if (premiumBps >= 100) return 'text-orange-400'; // Medium priority
    return 'text-white/60'; // Low priority
  };

  const getPriorityBadge = (premiumBps: number): string => {
    if (premiumBps >= 200) return 'HIGH';
    if (premiumBps >= 100) return 'MED';
    return 'LOW';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Panel Header — matches main dashboard style */}
      <div className="px-3 py-2 border-b border-white/[0.04]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-white/30" />
            <h2 className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
              Mempool Orders
            </h2>
            {orders.length > 0 && (
              <span className="text-[10px] border border-orange-500/30 text-orange-400 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
                {orders.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-white/[0.02] rounded border border-white/[0.06]">
              <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
              <span className="text-[9px] text-white/35 font-mono">Live</span>
            </div>
            <button
              onClick={fetchOrders}
              className="p-1 hover:bg-white/[0.04] rounded transition-colors"
            >
              <RotateCcw className="w-3 h-3 text-white/25 hover:text-white/50" />
            </button>
          </div>
        </div>
      </div>

      {/* Orders List */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/40">
            <Zap className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-[10px] font-mono">Mempool is empty</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {orders.map((order, index) => {
              const isSelected = selectedOrderId === order.id;
              const premiumPercent = (order.premium_bps_current / 100).toFixed(2);

              return (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.02 }}
                  onClick={() => onSelectOrder?.(order)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-orange-500/10 border-orange-500/40'
                      : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]'
                  }`}
                >
                  {/* Top Row */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-white/60">
                        #{order.order_number}
                      </span>
                      <span
                        className={`text-[8px] px-1.5 py-0.5 rounded font-mono font-bold ${
                          order.premium_bps_current >= 200
                            ? 'bg-orange-500/20 text-orange-500'
                            : order.premium_bps_current >= 100
                            ? 'bg-orange-500/20 text-orange-400'
                            : 'bg-white/10 text-white/50'
                        }`}
                      >
                        {getPriorityBadge(order.premium_bps_current)}
                      </span>
                      {order.auto_bump_enabled && (
                        <TrendingUp className="w-3 h-3 text-green-500" aria-label="Auto-bump enabled" />
                      )}
                    </div>

                    <div className="flex items-center gap-1 text-[10px] font-mono text-white/40">
                      <Clock className="w-3 h-3" />
                      {formatTimeRemaining(order.seconds_until_expiry)}
                    </div>
                  </div>

                  {/* Amount and Price */}
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-lg font-bold text-white font-mono">
                      {Number(order.amount_usdt).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-white/40 font-mono">USDT</span>
                    <ArrowRight className="w-3 h-3 text-white/30 mx-1" />
                    <span className={`text-base font-bold font-mono ${getPriorityColor(order.premium_bps_current)}`}>
                      {Number(order.current_offer_price).toFixed(6)}
                    </span>
                    <span className="text-[10px] text-white/40 font-mono">AED</span>
                  </div>

                  {/* Premium Info */}
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className="text-white/40">Premium:</span>
                      <span className={getPriorityColor(order.premium_bps_current)}>
                        +{premiumPercent}%
                      </span>
                      <span className="text-white/30">
                        ({order.premium_bps_current} bps)
                      </span>
                    </div>

                    <div className="text-white/30">
                      Cap: {(order.premium_bps_cap / 100).toFixed(2)}%
                    </div>
                  </div>

                  {/* Creator */}
                  {order.creator_username && (
                    <div className="mt-2 pt-2 border-t border-white/[0.04]">
                      <span className="text-[9px] text-white/30 font-mono">
                        By: {order.creator_username}
                      </span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
