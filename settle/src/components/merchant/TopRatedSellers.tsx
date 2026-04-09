'use client';

import { useState, useEffect } from 'react';
import { Star, Trophy, TrendingUp, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface TopRatedSeller {
  id: string;
  username: string;
  display_name: string;
  rating: number;
  rating_count: number;
  total_trades: number;
  wallet_address?: string;
  rank: number;
}

export function TopRatedSellers() {
  const [sellers, setSellers] = useState<TopRatedSeller[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchTopSellers();
    // Refresh every 5 minutes
    const interval = setInterval(fetchTopSellers, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchTopSellers = async () => {
    try {
      const res = await fetchWithAuth('/api/ratings?type=top-sellers&limit=10');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSellers(data.data.sellers || []);
        }
      }
    } catch (error) {
      console.error('Failed to fetch top sellers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getRankIcon = (rank: number) => {
    const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
    if (rankEmoji) {
      return <span className="text-sm">{rankEmoji}</span>;
    }
    return <span className="text-[11px] font-mono text-white/30">#{rank}</span>;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : sellers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
              <Star className="w-5 h-5 text-white/20" />
            </div>
            <div className="text-center">
              <p className="text-[11px] font-medium text-white/30 mb-0.5">No rated sellers yet</p>
              <p className="text-[9px] text-white/15 font-mono">Top sellers show here after ratings</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {sellers.map((seller, index) => (
              <motion.div
                key={seller.id}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className={`p-2.5 rounded-lg border transition-all ${
                  seller.rank <= 3
                    ? 'bg-primary/10 border-primary/20'
                    : 'bg-white/[0.02] border-white/[0.04] hover:border-border'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {/* Rank */}
                  <div className="w-6 text-center shrink-0">
                    {getRankIcon(seller.rank)}
                  </div>

                  {/* Avatar */}
                  <div className="w-7 h-7 rounded-full bg-white/5 border border-white/[0.06] flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-white/70">
                      {(seller.display_name || seller.username).slice(0, 2).toUpperCase()}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-white truncate">
                        {seller.display_name || seller.username}
                      </span>
                      {seller.rank <= 3 && (
                        <span className="text-[9px] px-1 py-0.5 bg-primary/20 text-primary rounded font-bold">
                          TOP {seller.rank}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-white/30">{seller.total_trades} trades</span>
                      <span className="text-[10px] text-white/20">·</span>
                      <div className="flex items-center gap-0.5">
                        <Star className="w-2.5 h-2.5 text-primary fill-primary" />
                        <span className="text-[10px] text-primary font-bold">
                          {seller.rating.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-white/20">
                          ({seller.rating_count})
                        </span>
                      </div>
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
