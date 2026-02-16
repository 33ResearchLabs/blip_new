'use client';

import { useState, useEffect } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
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

  const visibleEntries = entries.filter(e =>
    e.entry_type !== 'FEE' && e.entry_type !== 'FEE_EARNING'
  );

  const formatTime = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return 'now';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Mini header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.04]">
        <span className="text-[9px] text-white/20 font-mono">
          {lastUpdated ? `Updated ${formatTime(lastUpdated.toISOString())} ago` : '...'}
        </span>
        <button
          onClick={fetchLedger}
          className="p-1 hover:bg-white/[0.06] rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3 h-3 text-white/25 hover:text-white/50 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Ledger List */}
      <div className="flex-1 overflow-y-auto p-1">
        {isLoading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-4 h-4 text-orange-400/40 animate-spin" />
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
              <ArrowUpRight className="w-5 h-5 text-white/20" />
            </div>
            <div className="text-center">
              <p className="text-[11px] font-medium text-white/30 mb-0.5">No transactions yet</p>
              <p className="text-[9px] text-white/15 font-mono">Ledger entries appear after your first trade</p>
            </div>
          </div>
        ) : (
          <div className="space-y-px">
            {visibleEntries.map((entry) => {
              const isPositive = entry.amount >= 0;
              const label = entry.counterparty_name
                ? entry.counterparty_name
                : isPositive ? 'Money In' : 'Money Out';

              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors"
                >
                  {/* Direction icon */}
                  <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                    isPositive ? 'bg-emerald-500/[0.08]' : 'bg-white/[0.04]'
                  }`}>
                    {isPositive ? (
                      <ArrowDownRight className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <ArrowUpRight className="w-3 h-3 text-white/40" />
                    )}
                  </div>

                  {/* Label + order ref */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-white/60 truncate">{label}</span>
                      {entry.order_type && (
                        <span className="text-[9px] font-bold font-mono text-white/25 uppercase">{entry.order_type}</span>
                      )}
                    </div>
                  </div>

                  {/* Amount + time */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[11px] font-bold font-mono tabular-nums ${
                      isPositive ? 'text-emerald-400' : 'text-white/50'
                    }`}>
                      {isPositive ? '+' : ''}{entry.amount.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-white/20 font-mono w-6 text-right">
                      {formatTime(entry.created_at)}
                    </span>
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
