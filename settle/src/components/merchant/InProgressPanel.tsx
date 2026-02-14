'use client';

import { Clock, Shield, Zap, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { getAuthoritativeStatus, getStatusBadgeConfig, getNextAction as getNextActionFromStatus } from '@/lib/orders/statusResolver';

interface InProgressPanelProps {
  orders: any[];
  onSelectOrder: (order: any) => void;
}

export function InProgressPanel({ orders, onSelectOrder }: InProgressPanelProps) {
  const formatTimeRemaining = (seconds: number): string => {
    if (seconds <= 0) return 'Expired';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const getStatusBadge = (order: any) => {
    // ✅ Use authoritative minimal_status instead of legacy status
    const minimalStatus = getAuthoritativeStatus(order);
    const config = getStatusBadgeConfig(minimalStatus);

    return (
      <div
        data-testid="order-status"
        className={`px-2 py-1 ${config.bg} border ${config.border} rounded text-[10px] ${config.color} font-medium`}
      >
        {config.label}
      </div>
    );
  };

  const getNextAction = (order: any): string => {
    // ✅ Use status resolver to get next action based on minimal_status
    return getNextActionFromStatus(order, order.orderType || order.type);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#c9a962]" />
            <h2 className="text-xs font-bold text-white/90 font-mono tracking-wider">
              IN PROGRESS
            </h2>
          </div>
          <span className="text-xs border border-white/20 text-white/70 px-2 py-0.5 rounded-full font-medium">
            {orders.length}
          </span>
        </div>
      </div>

      {/* Orders List - Scrollable */}
      <div className="flex-1 overflow-y-auto p-2">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Shield className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-xs">No orders in progress</p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((order, index) => (
              <motion.div
                key={order.id}
                data-testid={`order-card-${order.id}`}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.02 }}
                onClick={() => onSelectOrder(order)}
                className="p-3 bg-[#1a1a1a] rounded-lg border border-white/[0.06] hover:border-[#c9a962]/30 hover:bg-[#1d1d1d] transition-all cursor-pointer"
              >
                {/* Top Row */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="text-xl">{order.emoji}</div>
                    <div>
                      <div className="text-xs font-medium text-white mb-0.5">
                        {order.user}
                      </div>
                      <div className="text-sm font-bold text-white">
                        {order.amount.toFixed(2)} {order.fromCurrency}
                      </div>
                    </div>
                  </div>
                  {getStatusBadge(order)}
                </div>

                {/* Countdown Timer */}
                {order.expiresIn > 0 && (
                  <div data-testid="order-timer" className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-white/[0.02] rounded-lg">
                    <Clock className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs text-gray-400 font-mono">
                      {formatTimeRemaining(order.expiresIn)}
                    </span>
                  </div>
                )}

                {/* Next Action Button */}
                <button
                  data-testid="order-primary-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectOrder(order);
                  }}
                  className="w-full py-2 bg-[#c9a962]/20 border border-[#c9a962]/30 rounded-lg text-xs text-[#c9a962] font-medium hover:bg-[#c9a962]/30 transition-colors flex items-center justify-center gap-2"
                >
                  <Zap className="w-3.5 h-3.5" />
                  {getNextAction(order)}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>

                {/* Unread Messages Badge */}
                {order.hasMessages && order.unreadCount > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[#c9a962]">
                    <div className="w-1.5 h-1.5 bg-[#c9a962] rounded-full animate-pulse" />
                    {order.unreadCount} new message{order.unreadCount > 1 ? 's' : ''}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
