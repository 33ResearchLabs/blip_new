"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Coins, Loader2, Check, Lock, ArrowRight } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { formatFiat, formatCount } from "@/lib/format";
import type { CoinTier, SurfaceTokens } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  surfaces: SurfaceTokens;
  /** Tier table from /api/limits/me (COIN_LIMIT_TIERS). */
  tiers?: Record<string, CoinTier>;
  /** Called after a successful stake so the parent can refetch limits. */
  onStaked: () => void;
}

const TIER_ORDER = ["L1", "L2", "L3", "L4"] as const;

export function StakeLimitModal({
  open,
  onClose,
  surfaces,
  tiers,
  onStaked,
}: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/coins/me");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) setBalance(Number(json.data?.balance ?? 0));
    } catch (err) {
      console.error("Failed to load coin balance:", err);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setError(null);
      setDone(false);
      fetchBalance();
    }
  }, [open, fetchBalance]);

  const stake = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/coins/spend/limit-bump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: selected }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setDone(true);
        await fetchBalance();
        onStaked();
        return;
      }
      if (json?.error === "KYC_REQUIRED") {
        setError(
          `This tier needs verification level ${json.required_kyc_level ?? 1}. Verify your phone first.`,
        );
      } else if (res.status === 402) {
        setError("Not enough BLIP points for this tier.");
      } else {
        setError(json?.error || "Couldn't stake for this tier.");
      }
    } catch (err) {
      console.error("Failed to stake limit bump:", err);
      setError("Couldn't stake for this tier.");
    } finally {
      setSubmitting(false);
    }
  };

  const tierRows = TIER_ORDER.map((k) => ({
    key: k as string,
    cfg: tiers?.[k],
  })).filter((t): t is { key: string; cfg: CoinTier } => Boolean(t.cfg));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => !submitting && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-2xl p-6 border border-border-subtle ${surfaces.card} max-h-[88vh] overflow-y-auto scrollbar-hide`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                  <Coins className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-bold text-text-primary">
                  Stake to Increase Limits
                </h3>
              </div>
              <button
                onClick={() => !submitting && onClose()}
                aria-label="Close"
                className={`p-1.5 rounded-lg text-text-tertiary hover:text-text-primary ${surfaces.hover} transition-colors shrink-0`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[12px] text-text-tertiary mb-4">
              Stake BLIP points to unlock a higher limit for 30 days.
            </p>

            {done ? (
              <div className="py-8 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-6 h-6" />
                </div>
                <p className="text-[15px] font-bold text-text-primary">
                  Limit unlocked
                </p>
                <p className="text-[13px] text-text-tertiary mt-1">
                  Your new limit is active for the next 30 days.
                </p>
                <button
                  onClick={onClose}
                  className="mt-6 w-full px-4 py-3 rounded-xl bg-accent text-accent-text text-[13px] font-bold hover:opacity-90 transition-opacity"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div
                  className={`flex items-center justify-between mb-4 px-3.5 py-3 rounded-xl border border-border-subtle ${surfaces.inset}`}
                >
                  <span className="text-[12px] text-text-tertiary">
                    Your BLIP balance
                  </span>
                  <span className="text-[13px] font-bold text-text-primary inline-flex items-center gap-1.5">
                    <Coins className="w-3.5 h-3.5 text-amber-500" />
                    {balance == null ? "—" : formatCount(balance)}
                  </span>
                </div>

                <div className="space-y-2">
                  {tierRows.map(({ key, cfg }) => {
                    const affordable =
                      balance != null && balance >= cfg.costCoins;
                    const isSel = selected === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setSelected(key)}
                        className={`w-full text-left px-4 py-3.5 rounded-xl border transition-colors ${
                          isSel
                            ? "border-amber-500/60 bg-amber-500/10"
                            : `border-border-subtle ${surfaces.inset} ${surfaces.hover}`
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[13px] font-bold text-text-primary">
                              {formatFiat(cfg.dailyUsd, "USD")}/day
                              <span className="text-text-tertiary font-medium">
                                {" "}
                                · {formatFiat(cfg.perTradeUsd, "USD")}/trade
                              </span>
                            </p>
                            <p className="text-[11px] text-text-tertiary mt-0.5 inline-flex items-center gap-1">
                              <Coins className="w-3 h-3 text-amber-500" />
                              {formatCount(cfg.costCoins)} BLIP
                              {cfg.requiresKyc > 0 && (
                                <span className="inline-flex items-center gap-0.5 ml-1.5 text-text-quaternary">
                                  <Lock className="w-3 h-3" />
                                  needs verification
                                </span>
                              )}
                            </p>
                          </div>
                          {!affordable && balance != null ? (
                            <span className="text-[10px] font-semibold text-amber-500/80 shrink-0">
                              Need more
                            </span>
                          ) : isSel ? (
                            <Check className="w-4 h-4 text-amber-500 shrink-0" />
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {error && (
                  <p className="text-[12px] text-red-400 mt-3">{error}</p>
                )}

                <div className="flex gap-3 mt-5">
                  <button
                    onClick={onClose}
                    disabled={submitting}
                    className={`flex-1 px-4 py-3 rounded-xl border border-border-subtle text-[13px] font-medium text-text-secondary ${surfaces.chip} ${surfaces.hover} transition-colors disabled:opacity-50`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={stake}
                    disabled={submitting || !selected}
                    className="flex-1 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[13px] font-bold transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        Stake
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
