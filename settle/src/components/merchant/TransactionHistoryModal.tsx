'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowUpRight, ArrowDownRight, Loader2, RefreshCw, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import type { Order } from '@/types/merchant';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  description: string;
  created_at: string;
  order_id?: string;
}

interface BalanceSummary {
  current_balance: number;
  total_credits: number;
  total_debits: number;
  total_transactions: number;
}

interface TransactionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  merchantId: string;
  orders?: Order[];
  effectiveBalance?: number | null;
}

/**
 * Derive transaction-like entries from completed/cancelled orders.
 * This works even when merchant_transactions table is empty (mock mode).
 */
function deriveTransactionsFromOrders(orders: Order[], merchantId: string): Transaction[] {
  const txs: Transaction[] = [];

  for (const order of orders) {
    if (order.status !== 'completed' && order.status !== 'cancelled') continue;

    const isCompleted = order.status === 'completed';
    const isSeller = order.myRole === 'seller' || order.orderMerchantId === merchantId;
    const isBuyer = order.myRole === 'buyer' || order.buyerMerchantId === merchantId;

    const completedAt = order.dbOrder?.completed_at || (order.dbOrder as any)?.updated_at || order.timestamp?.toISOString();
    const cancelledAt = (order.dbOrder as any)?.cancelled_at || (order.dbOrder as any)?.updated_at || order.timestamp?.toISOString();

    if (isCompleted) {
      if (isSeller) {
        // Seller sent USDT → money out
        txs.push({
          id: `${order.id}-out`,
          type: 'escrow_release',
          amount: -order.amount,
          balance_before: 0,
          balance_after: 0,
          description: `Sold ${order.amount} USDT to ${order.user} for ${Math.round(order.total)} AED`,
          created_at: typeof completedAt === 'string' ? completedAt : new Date(completedAt || Date.now()).toISOString(),
          order_id: order.id,
        });
      }
      if (isBuyer) {
        // Buyer received USDT → money in
        txs.push({
          id: `${order.id}-in`,
          type: 'order_completed',
          amount: order.amount,
          balance_before: 0,
          balance_after: 0,
          description: `Bought ${order.amount} USDT from ${order.user} for ${Math.round(order.total)} AED`,
          created_at: typeof completedAt === 'string' ? completedAt : new Date(completedAt || Date.now()).toISOString(),
          order_id: order.id,
        });
      }
    } else if (order.status === 'cancelled' && order.escrowTxHash) {
      // Cancelled with escrow → refund
      if (isSeller) {
        txs.push({
          id: `${order.id}-refund`,
          type: 'escrow_refund',
          amount: order.amount,
          balance_before: 0,
          balance_after: 0,
          description: `Escrow refunded ${order.amount} USDT (order cancelled)`,
          created_at: typeof cancelledAt === 'string' ? cancelledAt : new Date(cancelledAt || Date.now()).toISOString(),
          order_id: order.id,
        });
      }
    }
  }

  // Sort by date descending
  txs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return txs;
}

export function TransactionHistoryModal({
  isOpen,
  onClose,
  merchantId,
  orders = [],
  effectiveBalance,
}: TransactionHistoryModalProps) {
  const [apiTransactions, setApiTransactions] = useState<Transaction[]>([]);
  const [apiSummary, setApiSummary] = useState<BalanceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive transactions from orders (always available, even without DB entries)
  const orderDerivedTxs = useMemo(
    () => deriveTransactionsFromOrders(orders, merchantId),
    [orders, merchantId]
  );

  // Merge: prefer API transactions if available, otherwise use order-derived ones
  const transactions = apiTransactions.length > 0 ? apiTransactions : orderDerivedTxs;

  // Build summary from whatever source we have
  const summary: BalanceSummary | null = useMemo(() => {
    if (apiSummary && apiSummary.total_transactions > 0) return apiSummary;

    // Derive from order-based transactions
    const txs = transactions;
    if (txs.length === 0 && effectiveBalance == null) return null;

    const totalCredits = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalDebits = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

    return {
      current_balance: effectiveBalance ?? 0,
      total_credits: totalCredits,
      total_debits: totalDebits,
      total_transactions: txs.length,
    };
  }, [apiSummary, transactions, effectiveBalance]);

  const fetchTransactions = async () => {
    if (!merchantId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch summary
      const summaryRes = await fetchWithAuth(
        `/api/merchant/transactions?merchant_id=${merchantId}&summary=true`
      );
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        if (summaryData.success) {
          setApiSummary(summaryData.data);
        }
      }

      // Fetch transactions
      const txRes = await fetchWithAuth(
        `/api/merchant/transactions?merchant_id=${merchantId}&limit=50`
      );
      if (txRes.ok) {
        const txData = await txRes.json();
        if (txData.success) {
          setApiTransactions(txData.data);
        }
      }
    } catch (err) {
      console.error('Fetch transactions error:', err);
      // Don't show error if we have order-derived data
      if (orderDerivedTxs.length === 0) {
        setError(err instanceof Error ? err.message : 'Failed to load transactions');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && merchantId) {
      fetchTransactions();
    }
  }, [isOpen, merchantId]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    if (diffMins < 2880) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getTypeColor = (type: string) => {
    if (type.includes('release') || type.includes('completed') || type.includes('refund')) {
      return 'text-green-400';
    }
    if (type.includes('lock') || type.includes('cancelled')) {
      return 'text-red-400';
    }
    return 'text-foreground/40';
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      escrow_lock: 'Escrow Locked',
      escrow_release: 'Trade Completed',
      escrow_refund: 'Escrow Refunded',
      order_completed: 'Trade Completed',
      order_cancelled: 'Order Cancelled',
      fee_deduction: 'Platform Fee',
    };
    return labels[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="relative w-full max-w-lg bg-card-solid rounded-2xl border border-white/[0.08] shadow-2xl max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
            <div>
              <h2 className="text-base font-bold text-white">Transaction History</h2>
              <p className="text-xs text-foreground/40 mt-0.5">Your USDT in and out flow</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchTransactions}
                disabled={isLoading}
                className="p-2 hover:bg-card rounded-lg transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-foreground/40 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-card rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-foreground/40" />
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          {summary && (
            <div className="grid grid-cols-3 gap-2 p-4 border-b border-white/[0.06]">
              <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 rounded-xl p-3 border border-green-500/20">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-6 h-6 rounded-md bg-green-500/10 flex items-center justify-center">
                    <TrendingUp className="w-3 h-3 text-green-400" />
                  </div>
                  <p className="text-[10px] text-green-400/80 font-medium">Total In</p>
                </div>
                <p className="text-sm font-bold text-green-400">
                  +{formatNumber(summary.total_credits)}
                </p>
                <p className="text-[10px] text-foreground/35 mt-0.5">USDT</p>
              </div>

              <div className="bg-gradient-to-br from-red-500/10 to-red-600/5 rounded-xl p-3 border border-red-500/20">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-6 h-6 rounded-md bg-red-500/10 flex items-center justify-center">
                    <TrendingDown className="w-3 h-3 text-red-400" />
                  </div>
                  <p className="text-[10px] text-red-400/80 font-medium">Total Out</p>
                </div>
                <p className="text-sm font-bold text-red-400">
                  -{formatNumber(summary.total_debits)}
                </p>
                <p className="text-[10px] text-foreground/35 mt-0.5">USDT</p>
              </div>

              <div className="bg-gradient-to-br from-[#26A17B]/10 to-[#26A17B]/5 rounded-xl p-3 border border-[#26A17B]/20">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-6 h-6 rounded-md bg-[#26A17B]/10 flex items-center justify-center">
                    <DollarSign className="w-3 h-3 text-[#26A17B]" />
                  </div>
                  <p className="text-[10px] text-[#26A17B]/80 font-medium">Balance</p>
                </div>
                <p className="text-sm font-bold text-[#26A17B]">
                  {formatNumber(summary.current_balance)}
                </p>
                <p className="text-[10px] text-foreground/35 mt-0.5">USDT</p>
              </div>
            </div>
          )}

          {/* Transactions List */}
          <div className="flex-1 overflow-y-auto p-4">
            {isLoading && transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
                <p className="text-xs text-foreground/40">Loading transactions...</p>
              </div>
            ) : error && transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
                  <X className="w-6 h-6 text-red-400" />
                </div>
                <p className="text-xs text-red-400 mb-3">{error}</p>
                <button
                  onClick={fetchTransactions}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-accent-subtle rounded-lg transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span className="text-xs">Retry</span>
                </button>
              </div>
            ) : transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
                  <DollarSign className="w-6 h-6 text-foreground/35" />
                </div>
                <p className="text-xs text-foreground/35 mb-1">No transactions yet</p>
                <p className="text-[10px] text-gray-600">Complete a trade to see your history</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {transactions.map((tx) => (
                  <motion.div
                    key={tx.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-2.5 p-3 bg-white/[0.02] hover:bg-card rounded-xl border border-white/[0.06] transition-all group"
                  >
                    {/* Icon */}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        tx.amount > 0
                          ? 'bg-green-500/10 group-hover:bg-[var(--color-success)]/20'
                          : 'bg-red-500/10 group-hover:bg-[var(--color-error)]/20'
                      } transition-colors`}
                    >
                      {tx.amount > 0 ? (
                        <ArrowDownRight className="w-4 h-4 text-green-400" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4 text-red-400" />
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className={`text-xs font-semibold ${getTypeColor(tx.type)}`}>
                            {getTypeLabel(tx.type)}
                          </p>
                          <p className="text-[10px] text-foreground/35 mt-0.5 line-clamp-1">{tx.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p
                            className={`text-sm font-bold ${
                              tx.amount > 0 ? 'text-green-400' : 'text-red-400'
                            }`}
                          >
                            {tx.amount > 0 ? '+' : ''}
                            {formatNumber(Math.abs(tx.amount))} USDT
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-[10px] text-gray-600">{formatDate(tx.created_at)}</p>
                        {tx.order_id && (
                          <>
                            <span className="text-gray-700">·</span>
                            <p className="text-[10px] text-gray-600 font-mono">#{tx.order_id.slice(0, 8)}</p>
                          </>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-foreground/35">
                {transactions.length > 0 && `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`}
              </p>
              <button
                onClick={onClose}
                className="px-4 py-1.5 bg-white/5 hover:bg-accent-subtle rounded-lg transition-colors text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
