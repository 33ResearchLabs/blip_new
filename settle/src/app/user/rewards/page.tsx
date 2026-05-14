"use client";

/**
 * User Rewards Page
 *
 * Standalone scratch-card / cashback ledger view. Two sections:
 *
 *   1. Pending      — granted but not yet claimable (trade still in flight).
 *                     Tapping a pending card opens the ScratchRewardModal so
 *                     the user can scratch + reveal it. The reward stays
 *                     pending in DB until the order reaches `completed`.
 *
 *   2. Ready to use — claimable_at IS NOT NULL && voided_at IS NULL.
 *                     Withdraw CTA is rendered but disabled until the
 *                     withdrawal endpoint ships.
 *
 * Source of truth: GET /api/user/rewards (migrations 123 + 124).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Gift, Lock, Sparkles, Loader2 } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { formatCrypto } from "@/lib/format";
import { ScratchRewardModal } from "@/components/user/ScratchRewardModal";

interface RewardRow {
  id: string;
  order_id: string;
  amount_usdt: string;
  reward_bps: number;
  granted_at: string;
  revealed_at: string | null;
  claimable_at: string | null;
  voided_at: string | null;
}

interface RewardsResponse {
  claimable_total_usdt: number;
  pending_total_usdt: number;
  claimable_count: number;
  pending_count: number;
  unrevealed_count: number;
  recent: RewardRow[];
}

export default function UserRewardsPage() {
  const router = useRouter();
  const [data, setData] = useState<RewardsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scratchReward, setScratchReward] = useState<{
    id: string;
    amount_usdt: number;
    reward_bps: number;
    claimable_at: string | null;
  } | null>(null);

  const fetchRewards = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWithAuth("/api/user/rewards");
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error || "Failed to load");
      setData(j.data as RewardsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rewards");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRewards();
  }, []);

  const pending = (data?.recent ?? []).filter(
    (r) => !r.claimable_at && !r.voided_at,
  );
  const claimable = (data?.recent ?? []).filter(
    (r) => r.claimable_at && !r.voided_at,
  );

  return (
    <div className="min-h-[100dvh] bg-surface-base text-text-primary">
      <div className="h-12" />
      <div className="px-5 py-4 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 rounded-xl flex items-center justify-center bg-surface-raised border border-border-subtle"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4 text-text-secondary" />
        </button>
        <h1 className="text-[17px] font-semibold">Rewards</h1>
      </div>

      <div className="px-5 pb-10">
        {/* Totals summary */}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="rounded-2xl p-4 bg-surface-card border border-border-subtle">
            <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-text-tertiary">
              Pending
            </p>
            <p className="mt-1 text-[20px] font-bold tracking-[-0.02em]">
              {loading ? "—" : formatCrypto(data?.pending_total_usdt ?? 0)} USDT
            </p>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              unlocks when your trades complete
            </p>
          </div>
          <div className="rounded-2xl p-4 bg-surface-card border border-border-subtle">
            <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-text-tertiary">
              Ready to use
            </p>
            <p className="mt-1 text-[20px] font-bold tracking-[-0.02em]">
              {loading ? "—" : formatCrypto(data?.claimable_total_usdt ?? 0)} USDT
            </p>
            <p className="text-[11px] text-text-tertiary mt-0.5">claimable now</p>
          </div>
        </div>

        {/* Pending section */}
        <section className="mt-6">
          <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-text-tertiary mb-2">
            Pending
          </p>
          {loading ? (
            <div className="rounded-2xl p-6 bg-surface-card border border-border-subtle flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
            </div>
          ) : pending.length === 0 ? (
            <EmptyHint
              icon={<Lock className="w-5 h-5 text-text-tertiary" />}
              title="No pending rewards"
              subtitle="Start a UPI trade to earn cashback."
            />
          ) : (
            <ul className="space-y-2">
              {pending.map((r) => (
                <RewardCard
                  key={r.id}
                  row={r}
                  variant="pending"
                  onTap={() =>
                    setScratchReward({
                      id: r.id,
                      amount_usdt: Number(r.amount_usdt),
                      reward_bps: r.reward_bps,
                      claimable_at: r.claimable_at,
                    })
                  }
                />
              ))}
            </ul>
          )}
        </section>

        {/* Claimable section */}
        <section className="mt-6">
          <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-text-tertiary mb-2">
            Ready to use
          </p>
          {loading ? (
            <div className="rounded-2xl p-6 bg-surface-card border border-border-subtle flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
            </div>
          ) : claimable.length === 0 ? (
            <EmptyHint
              icon={<Gift className="w-5 h-5 text-text-tertiary" />}
              title="Nothing claimable yet"
              subtitle="Completed trades show up here."
            />
          ) : (
            <ul className="space-y-2">
              {claimable.map((r) => (
                <RewardCard key={r.id} row={r} variant="claimable" />
              ))}
            </ul>
          )}
          {claimable.length > 0 && (
            <button
              disabled
              className="mt-4 w-full py-3 rounded-xl text-sm font-bold tracking-[-0.01em] bg-surface-card border border-border-medium text-text-tertiary cursor-not-allowed"
              title="Withdraw is coming soon"
            >
              Withdraw — coming soon
            </button>
          )}
        </section>

        {error && (
          <p className="mt-4 text-[12px] text-error">{error}</p>
        )}
      </div>

      <ScratchRewardModal
        open={!!scratchReward}
        reward={scratchReward}
        onClose={() => {
          setScratchReward(null);
          // Refresh after dismiss so revealed_at reflects in the list.
          void fetchRewards();
        }}
        onDone={() => {
          setScratchReward(null);
          void fetchRewards();
        }}
      />
    </div>
  );
}

function RewardCard({
  row,
  variant,
  onTap,
}: {
  row: RewardRow;
  variant: "pending" | "claimable";
  onTap?: () => void;
}) {
  const isPending = variant === "pending";
  const isUnrevealed = !row.revealed_at;
  const dateStr = new Date(
    isPending ? row.granted_at : row.claimable_at || row.granted_at,
  ).toLocaleDateString();

  return (
    <li>
      <button
        onClick={onTap}
        disabled={!onTap}
        className={`w-full text-left rounded-2xl p-4 flex items-center justify-between gap-3 border ${
          isPending
            ? "bg-surface-card border-border-subtle opacity-90"
            : "bg-accent/10 border-accent/30"
        } ${onTap ? "active:scale-[0.99] transition-transform" : ""}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
              isPending ? "bg-surface-active" : "bg-accent/20"
            }`}
          >
            {isPending ? (
              <Lock className="w-4 h-4 text-text-tertiary" />
            ) : (
              <Sparkles className="w-4 h-4 text-accent" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold truncate">
              {isUnrevealed && isPending
                ? "Tap to scratch"
                : `${formatCrypto(Number(row.amount_usdt))} USDT`}
            </p>
            <p className="text-[11px] text-text-tertiary truncate">
              {isPending ? "unlocks when trade completes" : `Earned ${dateStr}`}
            </p>
          </div>
        </div>
        <p className="text-[11px] font-semibold text-text-tertiary shrink-0">
          {(row.reward_bps / 100).toFixed(2)}%
        </p>
      </button>
    </li>
  );
}

function EmptyHint({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-2xl p-6 bg-surface-card border border-border-subtle flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-surface-active flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-[14px] font-semibold">{title}</p>
        <p className="text-[12px] text-text-tertiary mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}
