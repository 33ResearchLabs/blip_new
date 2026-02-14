'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, Users, Clock, Loader2 } from 'lucide-react';

interface CorridorData {
  corridor_id: string;
  ref_price: number;
  volume_5m: number;
  avg_fill_time_sec: number;
  active_merchants_count: number;
  updated_at: string;
}

export function MarketSnapshot() {
  const [corridor, setCorridor] = useState<CorridorData | null>(null);
  const [prevPrice, setPrevPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchCorridorData();
    const interval = setInterval(fetchCorridorData, 30000); // Update every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchCorridorData = async () => {
    try {
      const res = await fetch('/api/mempool?type=corridor&corridor_id=USDT_AED');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data.corridor) {
          setPrevPrice(corridor?.ref_price || null);
          setCorridor(data.data.corridor);
        }
      }
    } catch (error) {
      console.error('Failed to fetch corridor data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const priceChange = prevPrice && corridor
    ? ((corridor.ref_price - prevPrice) / prevPrice) * 100
    : 0;

  const isPositive = priceChange >= 0;

  if (isLoading) {
    return (
      <div className="bg-[#0d0d0d] border border-white/[0.06] rounded-lg p-4 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-[#c9a962] animate-spin" />
      </div>
    );
  }

  if (!corridor) {
    return (
      <div className="bg-[#0d0d0d] border border-white/[0.06] rounded-lg p-4">
        <p className="text-sm text-white/40 text-center">No market data available</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0d0d0d] border border-white/[0.06] rounded-lg">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#c9a962]" />
          <span className="text-xs font-bold text-white/90 font-mono tracking-wider">
            MARKET SNAPSHOT
          </span>
          <span className="text-[10px] text-white/40 font-mono ml-auto">
            {corridor.corridor_id}
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="p-4 grid grid-cols-2 gap-4">
        {/* Reference Price */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] text-white/50 font-mono uppercase">Ref Price</span>
            {priceChange !== 0 && (
              <div className={`flex items-center gap-0.5 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                {isPositive ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                <span className="text-[9px] font-mono font-bold">
                  {isPositive ? '+' : ''}{priceChange.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
          <div className="text-2xl font-bold text-[#c9a962] font-mono">
            {Number(corridor.ref_price).toFixed(6)}
          </div>
          <div className="text-[10px] text-white/40 font-mono mt-0.5">
            AED/USDT
          </div>
        </div>

        {/* 5m Volume */}
        <div>
          <div className="text-[10px] text-white/50 font-mono uppercase mb-1">
            5m Volume
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {Number(corridor.volume_5m).toFixed(0)}
          </div>
          <div className="text-[10px] text-white/40 font-mono mt-0.5">
            USDT
          </div>
        </div>

        {/* Avg Fill Time */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="w-3 h-3 text-white/40" />
            <span className="text-[10px] text-white/50 font-mono uppercase">Avg Fill</span>
          </div>
          <div className="text-lg font-bold text-white font-mono">
            {corridor.avg_fill_time_sec}s
          </div>
        </div>

        {/* Active Merchants */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Users className="w-3 h-3 text-white/40" />
            <span className="text-[10px] text-white/50 font-mono uppercase">Merchants</span>
          </div>
          <div className="text-lg font-bold text-white font-mono">
            {corridor.active_merchants_count}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-white/[0.06] bg-white/[0.02]">
        <div className="text-[9px] text-white/30 font-mono text-center">
          Last updated: {new Date(corridor.updated_at).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
