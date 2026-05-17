"use client";

/**
 * Cross-chain USDT deposit modal — funded by LI.FI.
 *
 * v1 scope:
 *   1. User picks a source chain (Ethereum / Base / Arbitrum / …).
 *   2. Enters how much USDT they want to send.
 *   3. We quote LI.FI live, surface the breakdown (provider fee, Blip
 *      processing, gas, ETA, final received) so the user sees exactly
 *      what they're paying before committing.
 *   4. "Continue with LI.FI" deep-links to li.fi's hosted widget with
 *      our integrator + fee params pre-applied, so the EVM tx signing
 *      happens in their UI. We pick this back up via the Recent
 *      Activity feed once funds land on Solana.
 *
 * Phase 2 will replace the deep-link with in-app wagmi signing so the
 * user never leaves Blip. v1 ships the trust + fee story first.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowDownToLine, Loader2, X, ChevronDown, ExternalLink, Zap, AlertTriangle } from "lucide-react";
import {
  SOURCE_CHAINS,
  USDT_BY_CHAIN,
  USDT_SOLANA,
  SOLANA_CHAIN_ID,
  LIFI_INTEGRATOR_ID,
  BLIP_GROSS_FEE,
  type ChainOption,
} from "@/lib/lifi/config";
import { getCrossChainQuote, type CrossChainQuote } from "@/lib/lifi/quote";

interface CrossChainDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Destination Solana wallet — the user's Blip wallet. */
  destinationAddress: string | null;
}

const DEBOUNCE_MS = 500;

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtEta(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  const mins = Math.round(seconds / 60);
  return mins === 1 ? "~1 min" : `~${mins} min`;
}

export function CrossChainDepositModal({
  isOpen,
  onClose,
  destinationAddress,
}: CrossChainDepositModalProps) {
  const availableChains = useMemo(
    () => SOURCE_CHAINS.filter((c) => !c.comingSoon),
    [],
  );
  const [selectedChain, setSelectedChain] = useState<ChainOption>(availableChains[0]);
  const [chainPickerOpen, setChainPickerOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<CrossChainQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state when the modal opens — quotes are
  // time-sensitive so stale results from a prior session would lie.
  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setQuote(null);
      setError(null);
      setSelectedChain(availableChains[0]);
    }
  }, [isOpen, availableChains]);

  // Debounced live quote whenever amount or chain changes. Skips the
  // call entirely until the user types a positive amount AND has a
  // destination Solana address (rare but possible if the embedded
  // wallet hasn't loaded yet).
  useEffect(() => {
    if (!isOpen) return;
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0 || !destinationAddress) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const fromAmount = String(Math.floor(amt * 1_000_000)); // USDT 6 decimals
        // Source-address parity hack: LI.FI requires *some* valid
        // address for the source chain to compute gas. Until we have
        // EVM wallet connection (phase 2), use the zero address —
        // quote is still accurate for fee maths; only gas is a rough
        // estimate, which we surface as "~est".
        const result = await getCrossChainQuote({
          fromChainId: selectedChain.id,
          fromAddress: "0x0000000000000000000000000000000000000001",
          toAddress: destinationAddress,
          fromAmount,
        });
        if (cancelled) return;
        if (!result) {
          setError(
            "Couldn't get a quote right now — try a different chain or refresh.",
          );
        }
        setQuote(result);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Quote failed");
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amount, selectedChain, destinationAddress, isOpen]);

  // Hosted widget deep-link — we hand the user off to LI.FI to do the
  // actual source-chain signing. They'll see our integrator name on
  // their screen, our fee already applied, and the destination
  // hardcoded to the user's Solana wallet so they can't fat-finger it.
  const widgetUrl = useMemo(() => {
    if (!destinationAddress) return "https://jumper.exchange/";
    const fromToken = USDT_BY_CHAIN[selectedChain.id] ?? "";
    const qs = new URLSearchParams({
      fromChain: String(selectedChain.id),
      toChain: String(SOLANA_CHAIN_ID),
      fromToken,
      toToken: USDT_SOLANA,
      toAddress: destinationAddress,
      integrator: LIFI_INTEGRATOR_ID,
      fee: String(BLIP_GROSS_FEE),
    });
    if (amount && parseFloat(amount) > 0) qs.set("fromAmount", amount);
    return `https://jumper.exchange/?${qs.toString()}`;
  }, [selectedChain, destinationAddress, amount]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-md p-3 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-card-solid border border-white/[0.08] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{
          maxHeight: "92vh",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-foreground/[0.05] flex items-center justify-center">
              <ArrowDownToLine className="w-4 h-4 text-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Deposit from another chain</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-foreground/[0.04] text-foreground/40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Source chain picker */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-foreground/40 font-medium mb-1.5 block">
              From chain
            </label>
            <button
              onClick={() => setChainPickerOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="text-base">{selectedChain.flag}</span>
                <span className="text-sm font-semibold text-foreground">{selectedChain.label}</span>
                <span className="text-[10px] text-foreground/40 font-mono">{selectedChain.etaLabel}</span>
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-foreground/40 transition-transform ${chainPickerOpen ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {chainPickerOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 rounded-xl bg-foreground/[0.03] border border-foreground/[0.06] overflow-hidden"
                >
                  {SOURCE_CHAINS.map((c) => {
                    const disabled = !!c.comingSoon;
                    const active = c.id === selectedChain.id;
                    return (
                      <button
                        key={c.id}
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return;
                          setSelectedChain(c);
                          setChainPickerOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
                          active
                            ? "bg-foreground/[0.06]"
                            : disabled
                              ? "opacity-40 cursor-not-allowed"
                              : "hover:bg-foreground/[0.05]"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-base">{c.flag}</span>
                          <span className="text-sm font-medium text-foreground">{c.label}</span>
                        </span>
                        <span className="text-[10px] text-foreground/40 font-mono">
                          {disabled ? "Coming soon" : c.etaLabel}
                        </span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Amount */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-foreground/40 font-medium mb-1.5 block">
              Amount
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                maxLength={14}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                className="w-full bg-foreground/[0.04] rounded-xl px-3 py-2.5 pr-14 text-sm font-medium text-foreground outline-none placeholder:text-foreground/30 focus:ring-1 focus:ring-foreground/20"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-foreground/40">USDT</span>
            </div>
          </div>

          {/* Quote breakdown — surfaces every line that's coming out of
              the user's amount so they see exactly what they pay. */}
          {amount && parseFloat(amount) > 0 && (
            <div className="rounded-xl bg-foreground/[0.03] border border-foreground/[0.06]">
              <div className="px-3 py-2.5 flex items-center justify-between border-b border-foreground/[0.04]">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
                  <Zap className="w-3 h-3" />
                  You receive on Solana
                </span>
                <span className="text-sm font-bold tabular-nums text-foreground">
                  {quoting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground/40" />
                  ) : quote ? (
                    `${quote.receivedUsdt} USDT`
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <div className="px-3 py-2.5 space-y-1.5 text-[11px]">
                {/* Single "Bridge fee" line — sums provider + integrator
                    so the user sees one number. Splitting them out
                    would be transparent but noisy, and the integrator
                    cut is part of the bridge cost from the user's POV. */}
                <Row label={`Bridge fee · ${quote?.bridgeName ?? "—"}`} value={fmtUsd(quote?.providerFeeUsd ?? 0)} />
                <Row label="Gas (est.)" value={fmtUsd(quote?.gasFeeUsd ?? 0)} muted />
                <div className="pt-1.5 mt-1 border-t border-foreground/[0.04]">
                  <Row label="ETA" value={quote ? fmtEta(quote.etaSeconds) : selectedChain.etaLabel} muted />
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-3 py-2.5">
              <p className="text-[11px] text-rose-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" /> {error}
              </p>
            </div>
          )}

          {/* Continue */}
          <a
            href={widgetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-colors ${
              destinationAddress && amount && parseFloat(amount) > 0
                ? "bg-primary text-background hover:bg-primary/90"
                : "bg-foreground/[0.06] text-foreground/30 pointer-events-none"
            }`}
          >
            Continue on LI.FI
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <p className="text-[10px] text-foreground/40 text-center leading-relaxed">
            You'll be redirected to LI.FI's secure widget to sign the
            transaction on {selectedChain.label}. Funds land in your
            Blip wallet automatically when the bridge settles.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={muted ? "text-foreground/40" : "text-foreground/55"}>{label}</span>
      <span className={`tabular-nums font-medium ${muted ? "text-foreground/55" : "text-foreground/80"}`}>{value}</span>
    </div>
  );
}
