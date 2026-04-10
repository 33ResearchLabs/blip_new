'use client';

import { useState, useEffect, memo } from 'react';
import { Star, Trophy, ChevronUp, ChevronDown, Shield } from 'lucide-react';
import { FilterDropdown, type FilterOption } from '@/components/user/screens/ui/FilterDropdown';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

const LEADERBOARD_OPTIONS: ReadonlyArray<FilterOption<'traders' | 'rated' | 'reputation'>> = [
  { key: 'traders',    label: 'Volume' },
  { key: 'rated',      label: 'Rated'  },
  { key: 'reputation', label: 'Rep'    },
];

interface LeaderboardEntry {
  rank: number;
  id: string;
  displayName: string;
  username: string;
  totalTrades: number;
  totalVolume: number;
  rating: number;
  ratingCount: number;
  isOnline: boolean;
  avgResponseMins: number;
  completedCount: number;
}

interface RepLeaderboardEntry {
  entity_id: string;
  name: string;
  total_score: number;
  tier: string;
  rank: number;
}

const TIER_SHORT: Record<string, { label: string; cls: string }> = {
  newcomer: { label: 'NEW', cls: 'text-foreground/30' },
  bronze: { label: 'BRZ', cls: 'text-primary/70' },
  silver: { label: 'SLV', cls: 'text-foreground/50' },
  gold: { label: 'GLD', cls: 'text-yellow-400' },
  platinum: { label: 'PLT', cls: 'text-blue-200' },
  diamond: { label: 'DIA', cls: 'text-cyan-300' },
};

interface LeaderboardPanelProps {
  leaderboardData: LeaderboardEntry[];
  leaderboardTab: 'traders' | 'rated' | 'reputation';
  setLeaderboardTab: (tab: 'traders' | 'rated' | 'reputation') => void;
  onCollapseChange?: (collapsed: boolean) => void;
}

export const LeaderboardPanel = memo(function LeaderboardPanel({
  leaderboardData,
  leaderboardTab,
  setLeaderboardTab,
  onCollapseChange,
}: LeaderboardPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleCollapse = (collapsed: boolean) => {
    setIsCollapsed(collapsed);
    onCollapseChange?.(collapsed);
  };
  const [repData, setRepData] = useState<RepLeaderboardEntry[]>([]);

  useEffect(() => {
    if (leaderboardTab === 'reputation' && repData.length === 0) {
      fetchWithAuth('/api/reputation?action=leaderboard&entityType=merchant&limit=20')
        .then(r => r.json())
        .then(data => {
          if (data.success && data.data?.leaderboard) {
            setRepData(data.data.leaderboard);
          }
        })
        .catch(() => {});
    }
  }, [leaderboardTab]);

  const filteredData =
    leaderboardTab === 'traders'
      ? [...leaderboardData].sort((a, b) => b.totalVolume - a.totalVolume)
      : leaderboardTab === 'rated'
      ? [...leaderboardData].sort((a, b) => b.rating - a.rating)
      : [];

  return (
    <div className={`flex flex-col ${isCollapsed ? '' : 'h-full'}`}>
      {/* Header */}
      <div
        className="px-3 py-2 border-b border-section-divider cursor-pointer select-none hover:bg-foreground/[0.02] transition-colors"
        onClick={() => handleCollapse(!isCollapsed)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChevronDown className={`w-3 h-3 text-foreground/30 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`} />
            <Trophy className="w-3.5 h-3.5 text-foreground/30" />
            <h2 className="text-[10px] font-bold text-foreground/60 font-mono tracking-wider uppercase">
              Leaderboard
            </h2>
            {isCollapsed && (
              <span className="text-[11px] border border-foreground/[0.08] text-foreground/30 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
                {leaderboardData.length}
              </span>
            )}
          </div>
          {!isCollapsed && (
            <div onClick={(e) => e.stopPropagation()}>
              <FilterDropdown
                ariaLabel="Leaderboard sort"
                value={leaderboardTab}
                onChange={setLeaderboardTab}
                options={LEADERBOARD_OPTIONS}
              />
            </div>
          )}
        </div>
      </div>

      {/* List */}
      {!isCollapsed && <div className="flex-1 overflow-y-auto p-1">
        {leaderboardTab === 'reputation' ? (
          repData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
                <Shield className="w-5 h-5 text-foreground/20" />
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-foreground/30 mb-0.5">No scores yet</p>
                <p className="text-[10px] text-foreground/15 font-mono">Reputation scores populate after trades</p>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {repData.slice(0, 10).map((entry, i) => {
                const tierInfo = TIER_SHORT[entry.tier] || TIER_SHORT.newcomer;
                return (
                  <div
                    key={entry.entity_id}
                    className="flex items-center px-2 py-2.5 rounded-lg hover:bg-foreground/[0.03] transition-colors text-[11px] font-mono"
                  >
                    <span className="w-5 text-right font-bold shrink-0 tabular-nums text-foreground/25">
                      {i + 1}
                    </span>
                    <div className="flex items-center flex-1 min-w-0 pl-2">
                      <span className="text-xs font-medium text-foreground/70 truncate font-sans">{entry.name}</span>
                    </div>
                    <span className={`w-9 text-right font-bold shrink-0 ${tierInfo.cls}`}>{tierInfo.label}</span>
                    <span className="w-11 text-right text-foreground/40 font-bold tabular-nums shrink-0">{entry.total_score}</span>
                  </div>
                );
              })}
            </div>
          )
        ) : filteredData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
              <Trophy className="w-5 h-5 text-foreground/20" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-foreground/30 mb-0.5">No traders yet</p>
              <p className="text-[10px] text-foreground/15 font-mono">Rankings populate as trades complete</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredData.slice(0, 10).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center px-2 py-2.5 rounded-lg hover:bg-foreground/[0.03] transition-colors text-[11px] font-mono"
              >
                <span className="w-5 text-right font-bold shrink-0 tabular-nums text-foreground/25">
                  {entry.rank}
                </span>
                <div className="flex items-center flex-1 min-w-0 pl-2">
                  <span className="text-xs font-medium text-foreground/70 truncate font-sans">
                    {entry.displayName}
                  </span>
                </div>
                <span className="w-7 text-right text-foreground/25 shrink-0 tabular-nums">{entry.completedCount || entry.totalTrades}T</span>
                <span className="w-14 text-right text-foreground/40 font-bold shrink-0 tabular-nums">
                  {entry.totalVolume >= 1000
                    ? `$${(entry.totalVolume / 1000).toFixed(1)}k`
                    : `$${Math.round(entry.totalVolume)}`}
                </span>
                <span className="w-11 text-right flex items-center justify-end gap-0.5 text-primary/70 shrink-0">
                  <Star className="w-3 h-3 fill-primary/60 text-primary/60" />
                  {entry.rating.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>}
    </div>
  );
});
