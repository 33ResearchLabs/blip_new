'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowDownLeft, ArrowUpRight, Lock, Unlock, RotateCcw, Receipt, Loader2, RefreshCw } from 'lucide-react';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  description: string;
  order_id: string | null;
  created_at: string;
}

interface TransactionHistoryProps {
  merchantId: string | null;
}

const TX_ICONS: Record<string, typeof Lock> = {
  escrow_lock: Lock,
  escrow_release: Unlock,
  escrow_refund: RotateCcw,
  order_completed: ArrowDownLeft,
  order_cancelled: RotateCcw,
  fee_deduction: Receipt,
  synthetic_conversion: ArrowUpRight,
  manual_adjustment: ArrowUpRight,
};

const TX_LABELS: Record<string, string> = {
  escrow_lock: 'Escrow Lock',
  escrow_release: 'Escrow Release',
  escrow_refund: 'Refund',
  order_completed: 'Completed',
  order_cancelled: 'Cancelled',
  fee_deduction: 'Fee',
  synthetic_conversion: 'Conversion',
  manual_adjustment: 'Adjustment',
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

export function TransactionHistory({ merchantId }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTransactions = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetch(`/api/merchant/transactions?merchant_id=${merchantId}&limit=30`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setTransactions(data.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    fetchTransactions();
    const interval = setInterval(fetchTransactions, 30000);
    return () => clearInterval(interval);
  }, [fetchTransactions]);

  if (!merchantId) return null;

  return (
    <div className="mx-3 mb-2 bg-black border border-white/[0.08] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.02]">
        <span className="text-[9px] text-white/50 font-mono uppercase tracking-wider">Activity</span>
        <button
          onClick={fetchTransactions}
          className="p-0.5 rounded hover:bg-white/5 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3 text-white/30 hover:text-white/60" />
        </button>
      </div>

      {/* Scrollable List */}
      <div className="max-h-[180px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 text-white/20 animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-4 text-center text-[10px] text-white/20 font-mono">No activity yet</div>
        ) : (
          <div>
            {transactions.map((tx) => {
              const isCredit = tx.amount > 0;
              const Icon = TX_ICONS[tx.type] || ArrowUpRight;
              const label = TX_LABELS[tx.type] || tx.type;

              return (
                <div
                  key={tx.id}
                  className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-colors"
                >
                  {/* Icon */}
                  <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                    isCredit ? 'bg-green-500/10' : 'bg-red-500/10'
                  }`}>
                    <Icon className={`w-3 h-3 ${isCredit ? 'text-green-500' : 'text-red-400'}`} />
                  </div>

                  {/* Label + Description */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-white/70 font-medium truncate">{label}</div>
                    <div className="text-[9px] text-white/25 font-mono truncate">{tx.description}</div>
                  </div>

                  {/* Amount + Time */}
                  <div className="text-right shrink-0">
                    <div className={`text-[11px] font-mono font-bold ${isCredit ? 'text-green-500' : 'text-red-400'}`}>
                      {isCredit ? '+' : ''}{Number(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-[9px] text-white/20 font-mono">{timeAgo(tx.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
