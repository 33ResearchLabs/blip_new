'use client';

import { useState } from 'react';
import { Filter, X } from 'lucide-react';

export interface MempoolFilterState {
  minPremiumBps: string;
  maxPremiumBps: string;
  minAmount: string;
  maxAmount: string;
}

interface MempoolFiltersProps {
  filters: MempoolFilterState;
  onChange: (filters: MempoolFilterState) => void;
  onReset: () => void;
}

export function MempoolFilters({ filters, onChange, onReset }: MempoolFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasActiveFilters =
    filters.minPremiumBps ||
    filters.maxPremiumBps ||
    filters.minAmount ||
    filters.maxAmount;

  return (
    <div>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-white/30" />
          <span className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
            Filters
          </span>
          {hasActiveFilters && (
            <span className="text-[8px] px-1.5 py-0.5 bg-orange-500/20 text-orange-500 rounded font-mono font-bold">
              ACTIVE
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
              className="text-[9px] px-2 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30 font-mono hover:bg-red-500/30 transition-colors"
            >
              RESET
            </button>
          )}
          <span className="text-xs text-white/40">{isExpanded ? '▼' : '▶'}</span>
        </div>
      </button>

      {/* Filters */}
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-white/[0.04] pt-3 space-y-3">
          {/* Premium Range */}
          <div>
            <label className="block text-[10px] text-white/50 font-mono uppercase mb-2">
              Premium Range (bps)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                placeholder="Min"
                value={filters.minPremiumBps}
                onChange={(e) =>
                  onChange({ ...filters, minPremiumBps: e.target.value })
                }
                className="px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg
                           text-white font-mono text-xs focus:outline-none focus:border-orange-500/50
                           placeholder:text-white/20"
              />
              <input
                type="number"
                placeholder="Max"
                value={filters.maxPremiumBps}
                onChange={(e) =>
                  onChange({ ...filters, maxPremiumBps: e.target.value })
                }
                className="px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg
                           text-white font-mono text-xs focus:outline-none focus:border-orange-500/50
                           placeholder:text-white/20"
              />
            </div>
          </div>

          {/* Amount Range */}
          <div>
            <label className="block text-[10px] text-white/50 font-mono uppercase mb-2">
              Amount Range (USDT)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                placeholder="Min"
                value={filters.minAmount}
                onChange={(e) => onChange({ ...filters, minAmount: e.target.value })}
                className="px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg
                           text-white font-mono text-xs focus:outline-none focus:border-orange-500/50
                           placeholder:text-white/20"
              />
              <input
                type="number"
                placeholder="Max"
                value={filters.maxAmount}
                onChange={(e) => onChange({ ...filters, maxAmount: e.target.value })}
                className="px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg
                           text-white font-mono text-xs focus:outline-none focus:border-orange-500/50
                           placeholder:text-white/20"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
