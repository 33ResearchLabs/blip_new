'use client';

import { useState, useEffect, memo } from 'react';
import { Star, Trophy, ChevronUp, ChevronDown, Shield } from 'lucide-react';

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
  newcomer: { label: 'NEW', cls: 'text-white/30' },
  bronze: { label: 'BRZ', cls: 'text-orange-700' },
  silver: { label: 'SLV', cls: 'text-gray-400' },
  gold: { label: 'GLD', cls: 'text-yellow-400' },
  platinum: { label: 'PLT', cls: 'text-blue-200' },
  diamond: { label: 'DIA', cls: 'text-cyan-300' },
};

interface LeaderboardPanelProps {
  leaderboardData: LeaderboardEntry[];
  leaderboardTab: 'traders' | 'rated' | 'reputation';
  setLeaderboardTab: (tab: 'traders' | 'rated' | 'reputation') => void;
}

export const LeaderboardPanel = memo(function LeaderboardPanel({
  leaderboardData,
  leaderboardTab,
  setLeaderboardTab,
}: LeaderboardPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [repData, setRepData] = useState<RepLeaderboardEntry[]>([]);

  useEffect(() => {
    if (leaderboardTab === 'reputation' && repData.length === 0) {
      fetch('/api/reputation?action=leaderboard&entityType=merchant&limit=20')
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

  if (isCollapsed) {
    return (
      <div className="flex flex-col h-full justify-end">
        <button
          onClick={() => setIsCollapsed(false)}
          className="flex items-center justify-between px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] border-t border-white/[0.04] transition-all"
        >
          <div className="flex items-center gap-2">
            <Trophy className="w-3.5 h-3.5 text-white/30" />
            <span className="text-[11px] font-bold text-white/40 font-mono tracking-wider uppercase">
              Leaderboard
            </span>
            <span className="text-[11px] border border-white/[0.08] text-white/30 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
              {leaderboardData.length}
            </span>
          </div>
          <ChevronUp className="w-3.5 h-3.5 text-white/25" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.04]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-3.5 h-3.5 text-white/30" />
            <h2 className="text-[11px] font-bold text-white/60 font-mono tracking-wider uppercase">
              Leaderboard
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex gap-1">
              <button
                onClick={() => setLeaderboardTab('traders')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                  leaderboardTab === 'traders'
                    ? 'bg-white/[0.08] text-white/80 border border-white/[0.10]'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                Volume
              </button>
              <button
                onClick={() => setLeaderboardTab('rated')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                  leaderboardTab === 'rated'
                    ? 'bg-white/[0.08] text-white/80 border border-white/[0.10]'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                Rated
              </button>
              <button
                onClick={() => setLeaderboardTab('reputation')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                  leaderboardTab === 'reputation'
                    ? 'bg-white/[0.08] text-white/80 border border-white/[0.10]'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                Rep
              </button>
            </div>
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 rounded hover:bg-white/[0.06] transition-colors text-white/20 hover:text-white/40"
              title="Minimize"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-1">
        {leaderboardTab === 'reputation' ? (
          repData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
                <Shield className="w-5 h-5 text-white/20" />
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-white/30 mb-0.5">No scores yet</p>
                <p className="text-[10px] text-white/15 font-mono">Reputation scores populate after trades</p>
              </div>
            </div>
          ) : (
            <div className="space-y-px">
              {repData.slice(0, 10).map((entry, i) => {
                const tierInfo = TIER_SHORT[entry.tier] || TIER_SHORT.newcomer;
                return (
                  <div
                    key={entry.entity_id}
                    className="flex items-center px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors text-[11px] font-mono"
                  >
                    <span className={`w-7 text-right pr-1.5 font-bold shrink-0 ${
                      i < 3 ? 'text-orange-400' : 'text-white/25'
                    }`}>
                      {i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`}
                    </span>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0 pl-1.5">
                      <span className="text-xs font-medium text-white/70 truncate font-sans">{entry.name}</span>
                    </div>
                    <span className={`w-9 text-right font-bold shrink-0 ${tierInfo.cls}`}>{tierInfo.label}</span>
                    <span className="w-11 text-right text-white/40 font-bold tabular-nums shrink-0">{entry.total_score}</span>
                  </div>
                );
              })}
            </div>
          )
        ) : filteredData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
              <Trophy className="w-5 h-5 text-white/20" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-white/30 mb-0.5">No traders yet</p>
              <p className="text-[10px] text-white/15 font-mono">Rankings populate as trades complete</p>
            </div>
          </div>
        ) : (
          <div className="space-y-px">
            {filteredData.slice(0, 10).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors text-[11px] font-mono"
              >
                {/* Rank */}
                <span className={`w-7 text-right pr-1.5 font-bold shrink-0 ${
                  entry.rank <= 3 ? 'text-orange-400' : 'text-white/25'
                }`}>
                  {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
                </span>

                {/* Name + online dot */}
                <div className="flex items-center gap-1.5 flex-1 min-w-0 pl-1.5">
                  <span className="text-xs font-medium text-white/70 truncate font-sans">
                    {entry.displayName}
                  </span>
                  {entry.isOnline && (
                    <div className="w-2 h-2 bg-emerald-400 rounded-full shrink-0" />
                  )}
                </div>

                {/* Stats — fixed-width columns for alignment */}
                <span className="w-7 text-right text-white/25 shrink-0 tabular-nums">{entry.completedCount || entry.totalTrades}t</span>
                <span className="w-14 text-right text-white/40 font-bold shrink-0 tabular-nums">
                  {entry.totalVolume >= 1000
                    ? `$${(entry.totalVolume / 1000).toFixed(1)}k`
                    : `$${Math.round(entry.totalVolume)}`}
                </span>
                <span className="w-11 text-right flex items-center justify-end gap-0.5 text-orange-400/70 shrink-0">
                  <Star className="w-3 h-3 fill-orange-400/60 text-orange-400/60" />
                  {entry.rating.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
