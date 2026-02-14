'use client';

import { useState } from 'react';
import { CheckCircle2, History, Star, XCircle, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { TransactionsTab } from './TransactionsTab';

interface ActivityPanelProps {
  merchantId: string | null;
  completedOrders: any[];
  cancelledOrders?: any[];
  onRateOrder: (order: any) => void;
  onSelectOrder?: (orderId: string) => void;
}

export function ActivityPanel({
  merchantId,
  completedOrders,
  cancelledOrders = [],
  onRateOrder,
  onSelectOrder,
}: ActivityPanelProps) {
  const [activeTab, setActiveTab] = useState<'completed' | 'cancelled' | 'transactions'>('completed');

  const formatTime = (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const calculateProfit = (order: any): number => {
    // Simple profit calculation based on spread
    // In real implementation, this would consider actual fees and rates
    const baseAmount = order.amount;
    const spreadPercent = ((order.rate - 3.67) / 3.67) * 100; // Assuming 3.67 is base rate
    return baseAmount * (spreadPercent / 100);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with Tabs */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-gray-500" />
            <h2 className="text-xs font-bold text-white/90 font-mono tracking-wider">
              ACTIVITY
            </h2>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('completed')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                activeTab === 'completed'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Completed
            </button>
            <button
              onClick={() => setActiveTab('cancelled')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                activeTab === 'cancelled'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Cancelled{cancelledOrders.length > 0 ? ` (${cancelledOrders.length})` : ''}
            </button>
            <button
              onClick={() => setActiveTab('transactions')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                activeTab === 'transactions'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Transactions
            </button>
          </div>
        </div>
      </div>

      {/* Tab Content - Scrollable */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'cancelled' ? (
          <div className="h-full overflow-y-auto p-2">
            {cancelledOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <XCircle className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-xs">No cancelled orders</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {cancelledOrders.map((order, index) => {
                  const isCancelled = order.status === 'cancelled';
                  const isDisputed = order.status === 'disputed';
                  const statusLabel = isDisputed ? 'Disputed' : isCancelled ? 'Cancelled' : 'Expired';
                  const StatusIconComp = isDisputed ? AlertTriangle : XCircle;
                  const statusColor = isDisputed ? 'text-orange-400' : 'text-red-400';

                  return (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="p-2.5 bg-[#1a1a1a] rounded-lg border border-white/[0.06] hover:border-white/[0.12] transition-colors cursor-pointer"
                      onClick={() => onSelectOrder?.(order.id)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="text-base">{order.emoji}</div>
                          <div>
                            <div className="text-xs font-medium text-white">
                              {order.user}
                            </div>
                            <div className="text-[10px] text-gray-500 font-mono">
                              {order.amount.toFixed(2)} {order.fromCurrency}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <StatusIconComp className={`w-3.5 h-3.5 ${statusColor}`} />
                          <span className={`text-[10px] ${statusColor} font-medium`}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {formatTime(order.timestamp)}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'completed' ? (
          <div className="h-full overflow-y-auto p-2">
            {completedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <CheckCircle2 className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-xs">No completed orders</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {completedOrders.map((order, index) => {
                  const profit = calculateProfit(order);
                  const timeToComplete = order.dbOrder?.completed_at && order.dbOrder?.created_at
                    ? Math.floor(
                        (new Date(order.dbOrder.completed_at).getTime() -
                          new Date(order.dbOrder.created_at).getTime()) /
                          60000
                      )
                    : null;

                  return (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="p-2.5 bg-[#1a1a1a] rounded-lg border border-white/[0.06] hover:border-white/[0.12] transition-colors"
                    >
                      {/* Top Row */}
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="text-base">{order.emoji}</div>
                          <div>
                            <div className="text-xs font-medium text-white">
                              {order.user}
                            </div>
                            <div className="text-[10px] text-gray-500 font-mono">
                              {order.amount.toFixed(2)} {order.fromCurrency}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                          {profit > 0 && (
                            <span className="text-[10px] text-green-500 font-mono font-bold">
                              +${profit.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Bottom Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono">
                          <span>{formatTime(order.timestamp)}</span>
                          {timeToComplete && (
                            <>
                              <span>•</span>
                              <span>{timeToComplete}m</span>
                            </>
                          )}
                        </div>
                        {!order.dbOrder?.merchant_rated_at && (
                          <button
                            onClick={() => onRateOrder(order)}
                            className="flex items-center gap-1 text-[10px] text-[#c9a962] hover:text-[#d4b76e] font-medium transition-colors"
                          >
                            <Star className="w-3 h-3" />
                            Rate
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          merchantId && <TransactionsTab merchantId={merchantId} />
        )}
      </div>
    </div>
  );
}
