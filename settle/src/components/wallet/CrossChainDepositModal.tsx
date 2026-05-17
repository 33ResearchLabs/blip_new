"use client";

/**
 * Cross-chain USDT deposit modal — funded by LI.FI, signed in-app.
 *
 * Full v2 flow:
 *   1. User picks a source chain → modal shows the chain pill + ETA.
 *   2. Connects an injected EVM wallet (MetaMask / Coinbase / Brave / Rabby).
 *   3. If the wallet is on the wrong chain, prompts to switch.
 *   4. User enters an amount → live quote from li.quest/v1/quote, with
 *      our integrator + 1.33 % fee already baked in.
 *   5. Single "Send" button — handles ERC20 approval if needed, then
 *      submits the LI.FI tx via the wallet.
 *   6. Status poller hits /v1/status until DONE, surfaces progress
 *      inline (Submitted → Source confirmed → Bridging → Done) so the
 *      user knows where their funds are.
 *   7. On DONE → green check + final received USDT + tx links.
 *
 * Everything stays inside Blip — no jumper.exchange handoff. TRON is
 * still parked in the chain picker as "Coming soon"; needs TronLink
 * which isn't EIP-1193.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownToLine,
  Loader2,
  X,
  ChevronDown,
  Zap,
  AlertTriangle,
  Check,
  Wallet,
  ExternalLink,
} from "lucide-react";
import {
  SOURCE_CHAINS,
  type ChainOption,
} from "@/lib/lifi/config";
import { getCrossChainQuote, type CrossChainQuote } from "@/lib/lifi/quote";
import { pollUntilDone, type CrossChainStatus } from "@/lib/lifi/status";
import {
  connectEvm,
  getConnectedAddress,
  switchChain,
  getCurrentChainId,
  sendTransaction,
  readErc20Allowance,
  hasInjectedWallet,
} from "@/lib/lifi/evmWallet";

interface CrossChainDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  destinationAddress: string | null;
}

type Phase =
  | "idle"
  | "connecting"
  | "switching"
  | "approving"
  | "sending"
  | "polling"
  | "done"
  | "failed";

const DEBOUNCE_MS = 500;
// ERC20 approve(address,uint256) selector
const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
// Max uint256 — standard "infinite" approval. Saves the user from re-approving every deposit.
const MAX_UINT256 =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtEta(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  const mins = Math.round(seconds / 60);
  return mins === 1 ? "~1 min" : `~${mins} min`;
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
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

  // Wallet state
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);

  // Execution state
  const [phase, setPhase] = useState<Phase>("idle");
  const [phaseMessage, setPhaseMessage] = useState<string>("");
  const [sourceTxHash, setSourceTxHash] = useState<string | null>(null);
  const [destTxHash, setDestTxHash] = useState<string | null>(null);
  const [finalReceived, setFinalReceived] = useState<string | null>(null);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setQuote(null);
      setError(null);
      setSelectedChain(availableChains[0]);
      setPhase("idle");
      setPhaseMessage("");
      setSourceTxHash(null);
      setDestTxHash(null);
      setFinalReceived(null);
      // Surface any previously-granted wallet permission silently — no
      // popup, just enables the "send" CTA if a wallet is already
      // connected from a prior session.
      void getConnectedAddress().then((a) => {
        if (a) setEvmAddress(a);
        return getCurrentChainId();
      }).then((c) => {
        if (c) setWalletChainId(c);
      });
    }
  }, [isOpen, availableChains]);

  // Debounced live quote on chain / amount / wallet-address change.
  useEffect(() => {
    if (!isOpen) return;
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0 || !destinationAddress) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    // Until the wallet is connected we still fetch a quote so the user
    // can see the breakdown, using a placeholder source address. The
    // tx payload won't be usable for signing, but the fees + ETA are
    // accurate and that's all we render pre-connect.
    const sourceAddr = evmAddress ?? "0x0000000000000000000000000000000000000001";
    let cancelled = false;
    setQuoting(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const fromAmount = String(Math.floor(amt * 1_000_000)); // USDT 6 decimals
        const result = await getCrossChainQuote({
          fromChainId: selectedChain.id,
          fromAddress: sourceAddr,
          toAddress: destinationAddress,
          fromAmount,
        });
        if (cancelled) return;
        if (!result) {
          setError("Couldn't get a quote right now — try a different chain or refresh.");
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
  }, [amount, selectedChain, destinationAddress, evmAddress, isOpen]);

  const handleConnect = async () => {
    setError(null);
    setPhase("connecting");
    try {
      const addr = await connectEvm();
      setEvmAddress(addr);
      const cid = await getCurrentChainId();
      setWalletChainId(cid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect wallet");
    } finally {
      setPhase("idle");
    }
  };

  // True when the wallet is on the wrong chain for the selected
  // source. Solana (string id) is N/A — only EVM rows need switching.
  const wrongChain =
    !!evmAddress &&
    typeof selectedChain.id === "number" &&
    walletChainId !== selectedChain.id;

  const handleSwitch = async () => {
    if (typeof selectedChain.id !== "number") return;
    setError(null);
    setPhase("switching");
    try {
      await switchChain(selectedChain.id);
      const cid = await getCurrentChainId();
      setWalletChainId(cid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't switch chain");
    } finally {
      setPhase("idle");
    }
  };

  const handleSend = async () => {
    if (!quote || !quote.transactionRequest || !evmAddress) return;
    setError(null);
    setSourceTxHash(null);
    setDestTxHash(null);

    try {
      // 1) Approval check. USDT is an ERC20, so the bridge contract
      // can only pull the user's tokens if they've granted enough
      // allowance. Skip the popup when allowance >= amount.
      if (quote.approvalAddress) {
        const need = BigInt(quote.fromAmountBase);
        const have = await readErc20Allowance({
          token: quote.fromTokenAddress,
          owner: evmAddress,
          spender: quote.approvalAddress,
        });
        if (have < need) {
          setPhase("approving");
          setPhaseMessage("Approve USDT in your wallet…");
          // approve(spender, MAX_UINT256) so they only do this once
          const spender = quote.approvalAddress.replace(/^0x/, "").padStart(64, "0");
          const data =
            ERC20_APPROVE_SELECTOR +
            spender +
            MAX_UINT256.replace(/^0x/, "");
          await sendTransaction({
            from: evmAddress,
            to: quote.fromTokenAddress,
            data,
            value: "0x0",
          });
          // Don't need to wait for confirmation — LI.FI's tx will
          // revert if it lands before the approval, but on modern
          // wallets the next eth_sendTransaction respects the local
          // mempool ordering. We surface "Approving…" briefly so the
          // user sees it; if the bridge tx fails, the polled status
          // will say so.
        }
      }

      // 2) Submit the bridge tx itself.
      setPhase("sending");
      setPhaseMessage("Confirm the bridge in your wallet…");
      const tx = quote.transactionRequest;
      const hash = await sendTransaction({
        from: evmAddress,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gasLimit: tx.gasLimit,
      });
      setSourceTxHash(hash);

      // 3) Poll LI.FI status until the destination is credited.
      setPhase("polling");
      setPhaseMessage("Bridging to Solana…");
      const final = await pollUntilDone(hash, (s) => {
        // Translate LI.FI substatus codes into copy that's safe to
        // show a non-technical user. We deliberately don't reveal
        // every substatus — only the ones that map to a recognisable
        // step.
        if (s.substatus === "WAIT_SOURCE_CONFIRMATIONS") {
          setPhaseMessage("Waiting for source chain confirmation…");
        } else if (s.substatus === "WAIT_DESTINATION_TRANSACTION") {
          setPhaseMessage("Bridging to Solana…");
        } else if (s.status === "DONE") {
          setPhaseMessage("Done");
        }
      });

      if (final.status === "DONE") {
        setPhase("done");
        setDestTxHash(final.destinationTxHash ?? null);
        setFinalReceived(final.receivedUsdt ?? null);
      } else {
        setPhase("failed");
        setError(
          final.substatus === "REFUND_IN_PROGRESS" || final.substatus === "REFUNDED"
            ? "Bridge failed — funds are being refunded to your wallet."
            : "Bridge didn't complete in time. Check the explorer for status.",
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // User-rejected (code 4001) → friendly message, no scary error
      if (msg.includes("4001") || /reject/i.test(msg)) {
        setError("Transaction cancelled in wallet.");
      } else {
        setError(msg);
      }
      setPhase("idle");
    }
  };

  if (!isOpen) return null;

  const canSend =
    quote &&
    quote.transactionRequest &&
    evmAddress &&
    !wrongChain &&
    phase === "idle";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-md p-3 sm:p-4"
      onClick={() => phase === "idle" || phase === "done" || phase === "failed" ? onClose() : undefined}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-card-solid border border-white/[0.08] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: "92vh", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-foreground/[0.05] flex items-center justify-center">
              <ArrowDownToLine className="w-4 h-4 text-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">
              {phase === "done" ? "Deposit complete" : "Deposit from another chain"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-foreground/[0.04] text-foreground/40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* DONE state — bypasses the form entirely */}
        {phase === "done" ? (
          <div className="p-6 flex flex-col items-center gap-4 text-center">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 18 }}
              className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center"
            >
              <Check className="w-9 h-9 text-emerald-400" strokeWidth={3} />
            </motion.div>
            <div>
              <p className="text-base font-bold text-foreground">
                {finalReceived ? `${finalReceived} USDT` : "Funds delivered"}
              </p>
              <p className="text-[12px] text-foreground/50 mt-0.5">
                Received on Solana from {selectedChain.label}.
              </p>
            </div>
            {destTxHash && (
              <a
                href={`https://solscan.io/tx/${destTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-foreground/60 hover:text-foreground transition-colors flex items-center gap-1"
              >
                View on Solscan <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              onClick={onClose}
              className="w-full mt-2 py-3 rounded-xl bg-primary text-background font-bold text-sm"
            >
              Done
            </button>
          </div>
        ) : (
          // BODY (form)
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            {/* Wallet connect / status row */}
            <div className="flex items-center justify-between gap-2 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] px-3 py-2.5">
              <span className="flex items-center gap-2 min-w-0">
                <Wallet className={`w-4 h-4 shrink-0 ${evmAddress ? "text-emerald-400" : "text-foreground/40"}`} />
                <span className="text-[12px] font-medium text-foreground truncate">
                  {evmAddress ? short(evmAddress) : "EVM wallet not connected"}
                </span>
              </span>
              {!evmAddress ? (
                <button
                  onClick={handleConnect}
                  disabled={!hasInjectedWallet() || phase === "connecting"}
                  className="text-[11px] font-semibold text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {phase === "connecting" ? "Connecting…" : "Connect"}
                </button>
              ) : wrongChain ? (
                <button
                  onClick={handleSwitch}
                  disabled={phase === "switching"}
                  className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-40"
                >
                  {phase === "switching" ? "Switching…" : `Switch to ${selectedChain.label}`}
                </button>
              ) : (
                <span className="text-[11px] text-emerald-400 font-medium">Connected</span>
              )}
            </div>

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
              {chainPickerOpen && (
                <div className="mt-2 rounded-xl bg-foreground/[0.03] border border-foreground/[0.06] overflow-hidden">
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
                </div>
              )}
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
                  disabled={phase !== "idle"}
                  className="w-full bg-foreground/[0.04] rounded-xl px-3 py-2.5 pr-14 text-sm font-medium text-foreground outline-none placeholder:text-foreground/30 focus:ring-1 focus:ring-foreground/20 disabled:opacity-50"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-foreground/40">USDT</span>
              </div>
            </div>

            {/* Quote breakdown */}
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
                  <Row label={`Bridge fee · ${quote?.bridgeName ?? "—"}`} value={fmtUsd(quote?.providerFeeUsd ?? 0)} />
                  <Row label="Gas (est.)" value={fmtUsd(quote?.gasFeeUsd ?? 0)} muted />
                  <div className="pt-1.5 mt-1 border-t border-foreground/[0.04]">
                    <Row label="ETA" value={quote ? fmtEta(quote.etaSeconds) : selectedChain.etaLabel} muted />
                  </div>
                </div>
              </div>
            )}

            {/* In-flight phase strip */}
            {(phase === "approving" || phase === "sending" || phase === "polling") && (
              <div className="rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] px-3 py-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                <span className="text-[12px] text-foreground/80">{phaseMessage}</span>
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

            {/* CTA */}
            {!evmAddress ? (
              <button
                onClick={handleConnect}
                disabled={!hasInjectedWallet() || phase === "connecting"}
                className="w-full py-3 rounded-xl bg-primary text-background font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {phase === "connecting" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</>
                ) : !hasInjectedWallet() ? (
                  "Install a browser wallet"
                ) : (
                  <><Wallet className="w-4 h-4" /> Connect wallet</>
                )}
              </button>
            ) : wrongChain ? (
              <button
                onClick={handleSwitch}
                disabled={phase === "switching"}
                className="w-full py-3 rounded-xl bg-amber-500 text-background font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {phase === "switching" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Switching…</>
                ) : (
                  `Switch wallet to ${selectedChain.label}`
                )}
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="w-full py-3 rounded-xl bg-primary text-background font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {phase === "approving" || phase === "sending" || phase === "polling" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Working…</>
                ) : (
                  `Send ${amount || "0"} USDT`
                )}
              </button>
            )}

            <p className="text-[10px] text-foreground/40 text-center leading-relaxed">
              You'll sign on {selectedChain.label} from your connected wallet.
              Funds land in your Blip wallet on Solana automatically.
            </p>
          </div>
        )}
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
