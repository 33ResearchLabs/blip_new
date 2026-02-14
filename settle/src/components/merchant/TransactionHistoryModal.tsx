'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowUpRight, ArrowDownRight, Loader2, RefreshCw, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';

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
}

export function TransactionHistoryModal({
  isOpen,
  onClose,
  merchantId,
}: TransactionHistoryModalProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<BalanceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = async () => {
    if (!merchantId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch summary
      const summaryRes = await fetch(
        `/api/merchant/transactions?merchant_id=${merchantId}&summary=true`
      );
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        if (summaryData.success) {
          setSummary(summaryData.data);
        }
      }

      // Fetch transactions
      const txRes = await fetch(
        `/api/merchant/transactions?merchant_id=${merchantId}&limit=50`
      );
      if (txRes.ok) {
        const txData = await txRes.json();
        if (txData.success) {
          setTransactions(txData.data);
        }
      } else {
        throw new Error('Failed to fetch transactions');
      }
    } catch (err) {
      console.error('Fetch transactions error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
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
    return 'text-gray-400';
  };

  const getTypeLabel = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
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
          className="relative w-full max-w-3xl bg-[#0a0a0a] rounded-2xl border border-white/[0.08] shadow-2xl max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/[0.06]">
            <div>
              <h2 className="text-2xl font-bold text-white">Transaction History</h2>
              <p className="text-sm text-gray-400 mt-1">Your USDT in and out flow</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchTransactions}
                disabled={isLoading}
                className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 text-gray-400 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          {summary && (
            <div className="grid grid-cols-3 gap-4 p-6 border-b border-white/[0.06]">
              <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 rounded-xl p-4 border border-green-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                  </div>
                  <p className="text-xs text-green-400/80 font-medium">Total In</p>
                </div>
                <p className="text-xl font-bold text-green-400">
                  +{formatNumber(summary.total_credits)}
                </p>
                <p className="text-xs text-gray-500 mt-1">USDT</p>
              </div>

              <div className="bg-gradient-to-br from-red-500/10 to-red-600/5 rounded-xl p-4 border border-red-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                    <TrendingDown className="w-4 h-4 text-red-400" />
                  </div>
                  <p className="text-xs text-red-400/80 font-medium">Total Out</p>
                </div>
                <p className="text-xl font-bold text-red-400">
                  -{formatNumber(summary.total_debits)}
                </p>
                <p className="text-xs text-gray-500 mt-1">USDT</p>
              </div>

              <div className="bg-gradient-to-br from-[#26A17B]/10 to-[#26A17B]/5 rounded-xl p-4 border border-[#26A17B]/20">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-[#26A17B]/10 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-[#26A17B]" />
                  </div>
                  <p className="text-xs text-[#26A17B]/80 font-medium">Current Balance</p>
                </div>
                <p className="text-xl font-bold text-[#26A17B]">
                  {formatNumber(summary.current_balance)}
                </p>
                <p className="text-xs text-gray-500 mt-1">USDT</p>
              </div>
            </div>
          )}

          {/* Transactions List */}
          <div className="flex-1 overflow-y-auto p-6">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-10 h-10 text-orange-500 animate-spin mb-4" />
                <p className="text-sm text-gray-400">Loading transactions...</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                  <X className="w-8 h-8 text-red-400" />
                </div>
                <p className="text-red-400 mb-4">{error}</p>
                <button
                  onClick={fetchTransactions}
                  className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span className="text-sm">Retry</span>
                </button>
              </div>
            ) : transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <DollarSign className="w-8 h-8 text-gray-500" />
                </div>
                <p className="text-gray-500 mb-2">No transactions yet</p>
                <p className="text-xs text-gray-600">Your transaction history will appear here</p>
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx) => (
                  <motion.div
                    key={tx.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-3 p-4 bg-white/[0.02] hover:bg-white/[0.04] rounded-xl border border-white/[0.06] transition-all group"
                  >
                    {/* Icon */}
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                        tx.amount > 0
                          ? 'bg-green-500/10 group-hover:bg-green-500/20'
                          : 'bg-red-500/10 group-hover:bg-red-500/20'
                      } transition-colors`}
                    >
                      {tx.amount > 0 ? (
                        <ArrowDownRight className="w-5 h-5 text-green-400" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5 text-red-400" />
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className={`text-sm font-semibold ${getTypeColor(tx.type)}`}>
                            {getTypeLabel(tx.type)}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{tx.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p
                            className={`text-base font-bold ${
                              tx.amount > 0 ? 'text-green-400' : 'text-red-400'
                            }`}
                          >
                            {tx.amount > 0 ? '+' : ''}
                            {formatNumber(Math.abs(tx.amount))} USDT
                          </p>
                          <p className="text-xs text-gray-600 mt-0.5">
                            Balance: {formatNumber(tx.balance_after)} USDT
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <p className="text-xs text-gray-600">{formatDate(tx.created_at)}</p>
                        {tx.order_id && (
                          <>
                            <span className="text-gray-700">•</span>
                            <p className="text-xs text-gray-600">Order #{tx.order_id.slice(0, 8)}</p>
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
          <div className="p-6 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {transactions.length > 0 && `Showing ${transactions.length} recent transactions`}
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-sm font-medium"
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
