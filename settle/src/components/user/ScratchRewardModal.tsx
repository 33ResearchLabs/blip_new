"use client";

/**
 * ScratchRewardModal
 * ──────────────────
 * Modal shown after a sell order completes. Renders a scratchable cover —
 * user drags across it to reveal the reward amount, with confetti / sparkle
 * easing in at full opacity. After reveal, fetches the user's running total
 * from /api/user/rewards and shows it.
 *
 * Backed by the user_rewards table — no mock data. If the user closes early,
 * the row is still recorded server-side; we just mark it `revealed_at` once
 * the cover has been fully scratched (or "Reveal" tapped).
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

interface RewardLite {
  id: string;
  amount_usdt: number;
  reward_bps: number;
  /** NULL when reward is still pending (trade not yet completed). */
  claimable_at?: string | null;
}

interface Props {
  open: boolean;
  /** Specific reward to feature. If omitted, fetches the user's latest unrevealed reward. */
  reward?: RewardLite | null;
  onClose: () => void;
  /** Called after the user finishes (auto-routes to wallet). */
  onDone: () => void;
}

export function ScratchRewardModal({ open, reward: rewardProp, onClose, onDone }: Props) {
  const [reward, setReward] = useState<RewardLite | null>(rewardProp ?? null);
  const [claimableTotal, setClaimableTotal] = useState<number | null>(null);
  const [pendingTotal, setPendingTotal] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  // Fetch reward + totals when modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setRevealed(false);
    fetchWithAuth("/api/user/rewards")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const data = d?.data;
        if (data) {
          setClaimableTotal(Number(data.claimable_total_usdt ?? data.total_usdt ?? 0));
          setPendingTotal(Number(data.pending_total_usdt ?? 0));
          if (!rewardProp) {
            // Prefer an unrevealed *non-voided* row; pending or claimable both fine.
            const latestUnrevealed = (data.recent || []).find(
              (r: { revealed_at: string | null; voided_at: string | null }) =>
                !r.revealed_at && !r.voided_at,
            );
            if (latestUnrevealed) {
              setReward({
                id: latestUnrevealed.id,
                amount_usdt: Number(latestUnrevealed.amount_usdt),
                reward_bps: Number(latestUnrevealed.reward_bps),
                claimable_at: latestUnrevealed.claimable_at ?? null,
              });
            }
          }
        }
      })
      .catch(() => { /* network — show what we have */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, rewardProp]);

  // Paint the scratch cover on canvas.
  useEffect(() => {
    if (!open || revealed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    // Gradient cover
    const grad = ctx.createLinearGradient(0, 0, rect.width, rect.height);
    grad.addColorStop(0, "#6b7280");
    grad.addColorStop(1, "#374151");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, rect.width, rect.height);
    // Hint text
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "600 14px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.fillText("SCRATCH TO REVEAL", rect.width / 2, rect.height / 2);
  }, [open, revealed, reward]);

  const scratchAt = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    // Heuristic: measure transparency on a coarse grid; if >55% revealed,
    // flip to fully revealed state and mark on server.
    if (Math.random() < 0.18) {
      // Sample every Nth pixel to keep this cheap.
      const w = canvas.width, h = canvas.height;
      const data = ctx.getImageData(0, 0, w, h).data;
      let clear = 0, total = 0;
      for (let i = 3; i < data.length; i += 80) {
        total++;
        if (data[i] === 0) clear++;
      }
      if (total > 0 && clear / total > 0.55) reveal();
    }
  };

  const reveal = () => {
    if (revealed) return;
    setRevealed(true);
    // Mark on server. Non-blocking.
    if (reward?.id) {
      void fetchWithAuth("/api/user/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reward.id }),
      }).catch(() => { /* */ });
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drawingRef.current = true;
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    scratchAt(e.clientX - r.left, e.clientY - r.top);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    scratchAt(e.clientX - r.left, e.clientY - r.top);
  };
  const onPointerUp = () => { drawingRef.current = false; };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[140] bg-black/75"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            // Full-width sheet surface on phone (unchanged). On tablet (md:) cap
            // + centre it via auto-margins — left:0/right:0 + mx-auto centres a
            // fixed element WITHOUT a transform, so it never fights framer's
            // y-slide. Keeps every phone width byte-for-byte identical and stops
            // the sheet stretching edge-to-edge across a wide screen.
            className="fixed inset-x-0 bottom-0 z-[141] md:max-w-[680px] md:mx-auto bg-surface-base text-text-primary rounded-t-3xl border-t border-border-medium shadow-2xl"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="mx-auto max-w-[420px] md:max-w-[640px] px-5 py-5 pb-[max(env(safe-area-inset-bottom,16px),16px)]">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-text-tertiary">
                  Reward unlocked
                </p>
                <button onClick={onClose} className="p-1.5 rounded-full hover:bg-surface-hover">
                  <X className="w-4 h-4 text-text-tertiary" />
                </button>
              </div>

              <div className="mt-2 text-center">
                <Sparkles className="w-7 h-7 text-accent inline-block" />
                <p className="mt-2 text-[20px] font-bold tracking-[-0.02em]">A little something for you</p>
                <p className="text-[12px] text-text-tertiary">Scratch the card to reveal</p>
              </div>

              <div className="mt-4 relative rounded-3xl overflow-hidden border border-border-medium bg-gradient-to-br from-accent/15 via-accent/5 to-transparent">
                <div className="relative w-full aspect-[16/9] flex items-center justify-center">
                  {loading || !reward ? (
                    <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
                  ) : (
                    <div className="text-center px-6">
                      <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-text-tertiary">
                        Reward
                      </p>
                      <p className="mt-1 text-[36px] font-bold tracking-[-0.04em]">
                        +{reward.amount_usdt.toFixed(4)} USDT
                      </p>
                      <p className="mt-1 text-[11px] text-text-tertiary">
                        {(reward.reward_bps / 100).toFixed(2)}% cashback
                      </p>
                    </div>
                  )}
                  {!revealed && !loading && reward && (
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 w-full h-full rounded-3xl cursor-grab"
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerLeave={onPointerUp}
                    />
                  )}
                </div>
              </div>

              {!revealed && !loading && reward && (
                <button
                  onClick={reveal}
                  className="mt-3 w-full py-2.5 rounded-xl text-[12px] font-semibold bg-surface-card border border-border-medium"
                >
                  Or tap to reveal
                </button>
              )}

              {/* Pending banner — only shown once the user has revealed and
                  the reward is still in pending state (claimable_at == null). */}
              {revealed && reward && !reward.claimable_at && (
                <div className="mt-3 inline-flex items-start gap-2 w-full rounded-xl px-3 py-2.5 text-[12px] bg-yellow-500/10 border border-yellow-500/30 text-yellow-200">
                  <span aria-hidden>🔒</span>
                  <span className="leading-snug">
                    Will be credited to your wallet once the payment lands.
                  </span>
                </div>
              )}

              {/* Pending vs ready-to-use split */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl p-3 bg-surface-card border border-border-subtle">
                  <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-text-tertiary">
                    Pending
                  </p>
                  <p className="mt-1 text-[16px] font-bold tracking-[-0.02em]">
                    {pendingTotal === null ? "—" : `${pendingTotal.toFixed(4)} USDT`}
                  </p>
                  <p className="text-[10px] text-text-tertiary mt-0.5">unlocks when trade completes</p>
                </div>
                <div className="rounded-2xl p-3 bg-surface-card border border-border-subtle">
                  <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-text-tertiary">
                    Ready to use
                  </p>
                  <p className="mt-1 text-[16px] font-bold tracking-[-0.02em]">
                    {claimableTotal === null ? "—" : `${claimableTotal.toFixed(4)} USDT`}
                  </p>
                  <p className="text-[10px] text-text-tertiary mt-0.5">claimable now</p>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={onDone}
                className="mt-4 w-full py-3.5 rounded-xl text-sm font-bold tracking-[-0.01em] bg-accent text-accent-text inline-flex items-center justify-center gap-2"
              >
                Got it
                <ArrowRight className="w-4 h-4" />
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
