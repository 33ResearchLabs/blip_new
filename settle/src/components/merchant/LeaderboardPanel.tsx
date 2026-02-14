'use client';

import { motion } from 'framer-motion';
import { Star } from 'lucide-react';

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

interface LeaderboardPanelProps {
  leaderboardData: LeaderboardEntry[];
  leaderboardTab: 'traders' | 'rated';
  setLeaderboardTab: (tab: 'traders' | 'rated') => void;
}

export function LeaderboardPanel({
  leaderboardData,
  leaderboardTab,
  setLeaderboardTab,
}: LeaderboardPanelProps) {
  const filteredData =
    leaderboardTab === 'traders'
      ? [...leaderboardData].sort((a, b) => b.totalVolume - a.totalVolume)
      : [...leaderboardData].sort((a, b) => b.rating - a.rating);

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.05]">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-white/80">Leaderboard</h2>
          <div className="flex gap-1.5">
            <button
              onClick={() => setLeaderboardTab('traders')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                leaderboardTab === 'traders'
                  ? 'bg-white/[0.1] text-white'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              Volume
            </button>
            <button
              onClick={() => setLeaderboardTab('rated')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                leaderboardTab === 'rated'
                  ? 'bg-white/[0.1] text-white'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              Rated
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredData.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-white/30">No traders yet</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredData.slice(0, 20).map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: index * 0.015 }}
                className="p-2.5 bg-[#0d0d0d] border border-white/[0.04] rounded-lg hover:border-white/[0.08] hover:bg-[#111111] transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  {/* Rank */}
                  <div className={`text-base font-bold font-mono w-7 text-center ${
                    entry.rank <= 3 ? 'text-[#c9a962]' : 'text-white/40'
                  }`}>
                    {entry.rank}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-sm font-medium text-white truncate">
                        {entry.displayName}
                      </span>
                      {entry.isOnline && (
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/40">
                      <span>{entry.totalTrades} trades</span>
                      {leaderboardTab === 'traders' && (
                        <>
                          <span>•</span>
                          <span>${(entry.totalVolume / 1000).toFixed(1)}k</span>
                        </>
                      )}
                      {leaderboardTab === 'rated' && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            {entry.rating.toFixed(2)}
                            <Star className="w-3 h-3 fill-[#c9a962] text-[#c9a962]" />
                          </span>
                        </>
                      )}
                    </div>
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
