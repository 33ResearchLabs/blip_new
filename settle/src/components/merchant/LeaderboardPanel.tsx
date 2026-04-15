'use client';

import { useState, useEffect, memo } from 'react';
import { Star, Trophy, ChevronDown, Shield, Crown, Medal, Award } from 'lucide-react';
import { FilterDropdown, type FilterOption } from '@/components/user/screens/ui/FilterDropdown';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

/** Get a deterministic emoji for an entity name. Same util used elsewhere. */
function getEntityEmoji(name: string): string {
  const emojis = ['🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦋', '🐳', '🦄', '🐲', '🐺', '🦅', '🐢'];
  const hash = name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return emojis[hash % emojis.length];
}

/** Visual treatment — plain neutral badges. Top 3 still get rank icons
 *  (Crown / Medal / Award) so the hierarchy reads at a glance, but no
 *  colored gradients — keeps the panel calm and on-theme. */
function rankStyle(rank: number) {
  const baseBadge = 'bg-foreground/[0.06] text-foreground/60 ring-foreground/[0.08]';
  const baseRow = 'border-foreground/[0.05]';
  if (rank === 1) return { badge: baseBadge, row: baseRow, Icon: Crown };
  if (rank === 2) return { badge: baseBadge, row: baseRow, Icon: Medal };
  if (rank === 3) return { badge: baseBadge, row: baseRow, Icon: Award };
  return { badge: baseBadge, row: baseRow, Icon: null as React.ComponentType<{ className?: string }> | null };
}

/** Compact volume formatter — $279.1k, $1.2M */
function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

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
                const rank = i + 1;
                const tierInfo = TIER_SHORT[entry.tier] || TIER_SHORT.newcomer;
                const style = rankStyle(rank);
                const RankIcon = style.Icon;
                return (
                  <div
                    key={entry.entity_id}
                    className={`group flex items-center gap-2 px-2 py-2 rounded-xl border transition-all hover:border-foreground/[0.10] hover:shadow-sm hover:shadow-black/20 ${style.row}`}
                  >
                    {/* Rank badge */}
                    <div className={`relative w-7 h-7 rounded-full flex items-center justify-center shrink-0 ring-1 ${style.badge}`}>
                      {RankIcon ? (
                        <RankIcon className="w-3.5 h-3.5" />
                      ) : (
                        <span className="text-[10px] font-extrabold tabular-nums">{rank}</span>
                      )}
                    </div>

                    {/* Avatar + name */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-6 h-6 rounded-lg bg-foreground/[0.04] border border-foreground/[0.06] flex items-center justify-center text-xs shrink-0">
                        {getEntityEmoji(entry.name)}
                      </div>
                      <span className="text-[12px] font-semibold text-foreground/85 truncate">
                        {entry.name}
                      </span>
                    </div>

                    {/* Tier badge */}
                    <span className={`text-[9px] font-extrabold font-mono tracking-wider px-1.5 py-0.5 rounded shrink-0 bg-foreground/[0.04] border border-foreground/[0.06] ${tierInfo.cls}`}>
                      {tierInfo.label}
                    </span>

                    {/* Score */}
                    <span className="text-[12px] font-extrabold tabular-nums text-foreground shrink-0 min-w-[40px] text-right">
                      {entry.total_score}
                    </span>
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
            {filteredData.slice(0, 10).map((entry) => {
              const style = rankStyle(entry.rank);
              const RankIcon = style.Icon;
              return (
                <div
                  key={entry.id}
                  className={`group flex items-center gap-2 px-2 py-2 rounded-xl border transition-all hover:border-foreground/[0.10] hover:shadow-sm hover:shadow-black/20 ${style.row}`}
                >
                  {/* Rank badge — gold/silver/bronze for top 3 */}
                  <div className={`relative w-7 h-7 rounded-full flex items-center justify-center shrink-0 ring-1 ${style.badge}`}>
                    {RankIcon ? (
                      <RankIcon className="w-3.5 h-3.5" />
                    ) : (
                      <span className="text-[10px] font-extrabold tabular-nums">{entry.rank}</span>
                    )}
                  </div>

                  {/* Avatar + name */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="w-6 h-6 rounded-lg bg-foreground/[0.04] border border-foreground/[0.06] flex items-center justify-center text-xs shrink-0">
                      {getEntityEmoji(entry.displayName)}
                    </div>
                    <span className="text-[12px] font-semibold text-foreground/85 truncate">
                      {entry.displayName}
                    </span>
                  </div>

                  {/* Trades count */}
                  <span className="text-[10px] font-mono tabular-nums text-foreground/30 shrink-0">
                    {entry.completedCount || entry.totalTrades}T
                  </span>

                  {/* Volume — primary metric */}
                  <span className="text-[12px] font-extrabold tabular-nums text-foreground shrink-0 min-w-[52px] text-right">
                    {formatVolume(entry.totalVolume)}
                  </span>

                  {/* Rating */}
                  <span className="flex items-center gap-0.5 text-[11px] font-bold text-primary tabular-nums shrink-0 min-w-[34px] justify-end">
                    <Star className="w-3 h-3 fill-primary text-primary" />
                    {entry.rating.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>}
    </div>
  );
});
