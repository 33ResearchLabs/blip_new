"use client";

/**
 * ReputationCoinBadge — a single compact widget surfaced in the
 * merchant dashboard, the user dashboard, and the waitlist dashboard.
 *
 * Shows:
 *   - Reputation tier (Restricted / New / Bronze / Silver / Gold / Platinum)
 *   - Reputation score (300–900)
 *   - Coin balance (with hard-cap headroom hint)
 *   - Locked-coin marker if any are still locked
 *
 * Two layouts via `variant`:
 *   - 'pill'    — single-row inline pill for status cards
 *   - 'card'    — stacked card for dashboards / waitlist
 *
 * Designed for read-only display. Spending lives in /api/coins/spend/* —
 * a separate modal opens those flows.
 */

import { useEffect, useState } from 'react';
import { Shield, Coins, Lock } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface ReputationData {
  total_score: number;
  tier: string;
  tier_info: { name: string; color: string; description: string };
  badges: string[];
  is_default: boolean;
}

interface CoinData {
  balance: number;
  locked: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  headroomToHardCap: number;
  hard_cap: number;
}

interface Props {
  variant?: 'pill' | 'card';
  /** Hide the rep half (waitlist may want to show coins only initially). */
  hideRep?: boolean;
  /** Hide the coin half (some merchant surfaces may only want rep). */
  hideCoins?: boolean;
  className?: string;
}

export function ReputationCoinBadge({
  variant = 'card',
  hideRep,
  hideCoins,
  className,
}: Props) {
  const [rep, setRep] = useState<ReputationData | null>(null);
  const [coins, setCoins] = useState<CoinData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tasks: Promise<unknown>[] = [];
        if (!hideRep) {
          tasks.push(
            fetchWithAuth('/api/reputation/me')
              .then((r) => (r.ok ? r.json() : null))
              .then((j) => { if (!cancelled && j?.data) setRep(j.data); }),
          );
        }
        if (!hideCoins) {
          tasks.push(
            fetchWithAuth('/api/coins/me')
              .then((r) => (r.ok ? r.json() : null))
              .then((j) => { if (!cancelled && j?.data) setCoins(j.data); }),
          );
        }
        await Promise.all(tasks);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hideRep, hideCoins]);

  if (variant === 'pill') {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
        {!hideRep && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
            style={{
              backgroundColor: rep ? `${rep.tier_info.color}1f` : 'rgba(255,255,255,0.05)',
              color: rep?.tier_info.color ?? 'rgba(255,255,255,0.4)',
              border: `1px solid ${rep?.tier_info.color ?? 'rgba(255,255,255,0.08)'}33`,
            }}
            title={rep?.tier_info.description}
          >
            <Shield className="w-2.5 h-2.5" />
            {loading ? '—' : rep?.tier_info.name ?? 'New'} · {loading ? '—' : rep?.total_score ?? 500}
          </span>
        )}
        {!hideCoins && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-300">
            <Coins className="w-2.5 h-2.5" />
            {loading ? '—' : (coins?.balance ?? 0).toLocaleString('en-US')}
            {coins && coins.locked > 0 && (
              <span className="ml-1 inline-flex items-center text-amber-200/60" title={`${coins.locked} locked`}>
                <Lock className="w-2 h-2" />
              </span>
            )}
          </span>
        )}
      </div>
    );
  }

  // 'card' variant — stacked, used on dashboards / waitlist.
  return (
    <div
      className={`rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] p-3 space-y-2 ${className ?? ''}`}
    >
      {!hideRep && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield
              className="w-4 h-4"
              style={{ color: rep?.tier_info.color ?? 'rgba(255,255,255,0.4)' }}
            />
            <span className="text-[11px] font-mono uppercase tracking-wider text-foreground/40">
              Reputation
            </span>
          </div>
          <div className="text-right">
            <div
              className="text-[14px] font-bold tabular-nums"
              style={{ color: rep?.tier_info.color ?? 'rgba(255,255,255,0.8)' }}
            >
              {loading ? '—' : rep?.total_score ?? 500}
            </div>
            <div className="text-[9px] text-foreground/40 -mt-0.5">
              {loading ? '—' : rep?.tier_info.name ?? 'New'}
            </div>
          </div>
        </div>
      )}
      {!hideCoins && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-amber-400" />
            <span className="text-[11px] font-mono uppercase tracking-wider text-foreground/40">
              Coins
            </span>
          </div>
          <div className="text-right">
            <div className="text-[14px] font-bold tabular-nums text-amber-300">
              {loading ? '—' : (coins?.balance ?? 0).toLocaleString('en-US')}
            </div>
            {coins && coins.locked > 0 && (
              <div className="text-[9px] text-amber-200/50 -mt-0.5 flex items-center gap-0.5 justify-end">
                <Lock className="w-2.5 h-2.5" /> {coins.locked.toLocaleString('en-US')} locked
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
