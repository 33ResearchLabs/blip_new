'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  ArrowDownRight,
  Lock,
  Unlock,
  DollarSign,
  RefreshCw,
  Loader2,
  ExternalLink,
} from 'lucide-react';

interface LedgerEntry {
  id: string;
  entry_type: string;
  amount: number;
  asset: string;
  related_order_id: string | null;
  related_tx_hash: string | null;
  description: string | null;
  order_number: string | null;
  order_type: 'buy' | 'sell' | null;
  counterparty_name: string | null;
  created_at: string;
}

interface TransactionsTabProps {
  merchantId: string;
}

export function TransactionsTab({ merchantId }: TransactionsTabProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchLedger = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/ledger?merchant_id=${merchantId}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setEntries(data.data.entries || []);
          setLastUpdated(new Date());
        }
      }
    } catch (error) {
      console.error('Failed to fetch ledger:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
  }, [merchantId]);

  const getEntryIcon = (amount: number) => {
    // Simple: Money In or Money Out
    if (amount >= 0) {
      return <ArrowDownRight className="w-4 h-4 text-green-500" />;
    } else {
      return <ArrowUpRight className="w-4 h-4 text-red-500" />;
    }
  };

  const getEntryColor = (amount: number) => {
    return amount >= 0 ? 'text-green-500' : 'text-red-500';
  };

  const formatEntryType = (amount: number) => {
    // Simple: "Money In" or "Money Out"
    return amount >= 0 ? 'Money In' : 'Money Out';
  };

  // Filter out internal entries (fees) - only show actual money movements
  const visibleEntries = entries.filter(e =>
    e.entry_type !== 'FEE' && e.entry_type !== 'FEE_EARNING'
  );

  const formatTime = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-[10px] text-gray-500 font-mono">
            {lastUpdated ? `Updated ${formatTime(lastUpdated.toISOString())}` : 'Loading...'}
          </span>
        </div>
        <button
          onClick={fetchLedger}
          className="p-1 hover:bg-white/5 rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5 text-gray-500 hover:text-white" />
        </button>
      </div>

      {/* Ledger List */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 text-[#c9a962] animate-spin" />
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <RefreshCw className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-xs">No transactions yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {visibleEntries.map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02 }}
                className="p-2.5 bg-[#1a1a1a] rounded-lg border border-white/[0.06] hover:border-white/[0.12] transition-colors"
              >
                <div className="flex items-center gap-3">
                  {/* Icon */}
                  <div className="w-8 h-8 rounded-lg bg-[#252525] flex items-center justify-center shrink-0">
                    {getEntryIcon(entry.amount)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium text-white capitalize">
                        {entry.counterparty_name && entry.order_type
                          ? `${entry.counterparty_name} (${entry.order_type})`
                          : entry.order_type || formatEntryType(entry.amount)}
                      </span>
                      <span className={`text-xs font-bold font-mono ${getEntryColor(entry.amount)}`}>
                        {entry.amount >= 0 ? '+' : '-'}{Math.abs(entry.amount).toFixed(2)} {entry.asset}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-mono">
                        {entry.order_number ? (
                          <span>#{entry.order_number}</span>
                        ) : entry.related_tx_hash ? (
                          <a
                            href={`https://explorer.solana.com/tx/${entry.related_tx_hash}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-0.5 hover:text-white transition-colors"
                          >
                            TX <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : (
                          <span>—</span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-500 font-mono">
                        {formatTime(entry.created_at)}
                      </span>
                    </div>
                    {entry.description && (
                      <p className="text-[10px] text-gray-600 mt-1 truncate">
                        {entry.description}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
