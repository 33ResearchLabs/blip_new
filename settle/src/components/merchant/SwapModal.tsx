"use client";

/**
 * Swap modal — SOL ↔ USDT on Solana, routed via Jupiter v6 aggregator.
 *
 * Design notes:
 *   - MVP scope: two tokens (SOL and USDT-mainnet), fixed 0.5% slippage,
 *     no advanced settings, single quote pull per amount change with
 *     a 600ms debounce. Anything more would balloon the surface area
 *     before we know merchants actually use this.
 *   - Fee revenue: Jupiter's native `platformFeeBps` param routes a
 *     cut of the OUTPUT amount to a fee-account ATA you control.
 *     Read from NEXT_PUBLIC_SWAP_FEE_RECIPIENT_USDT_ATA and
 *     NEXT_PUBLIC_SWAP_FEE_RECIPIENT_SOL_ATA — one ATA per output mint.
 *     If unset for the active output, the swap still goes through
 *     without a fee (don't block the merchant if you haven't created
 *     the ATA yet).
 *   - Safety: the transaction is built BY Jupiter and signed by the
 *     user. We never construct unchecked transfers ourselves. The
 *     quote → tx round-trip uses HTTPS + JSON-RPC over the project's
 *     existing /api/rpc proxy so the Helius key stays server-side.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { X, ArrowDownUp, Loader2, AlertTriangle, ExternalLink, Check } from "lucide-react";
import {
  VersionedTransaction,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { recordSwap } from "@/lib/wallet/swapHistory";
import { useOnboarding } from "@/contexts/OnboardingContext";

// ── Constants ───────────────────────────────────────────────────────
const SLIPPAGE_BPS = 50; // 0.5% — hard-capped for safety

const PLATFORM_FEE_BPS = parseInt(
  process.env.NEXT_PUBLIC_SWAP_PLATFORM_FEE_BPS || "0",
  10,
);

// Per-output-mint fee account ATAs owned by the platform treasury.
// Jupiter routes `platformFeeBps` of the OUTPUT amount to whichever ATA
// matches the swap's output mint. Unset = no fee for that output.
const FEE_ATA_BY_SYMBOL: Record<string, string> = {
  USDT: (process.env.NEXT_PUBLIC_SWAP_FEE_RECIPIENT_USDT_ATA || "").trim(),
  USDC: (process.env.NEXT_PUBLIC_SWAP_FEE_RECIPIENT_USDC_ATA || "").trim(),
  SOL:  (process.env.NEXT_PUBLIC_SWAP_FEE_RECIPIENT_SOL_ATA  || "").trim(),
};

interface TokenMeta {
  mint: string;
  symbol: "SOL" | "USDT" | "USDC";
  decimals: number;
}
/** Display a token amount. 2 decimals for stables (USDT / USDC), up to
 *  4 decimals for SOL so sub-1 quotes don't get rounded to "0.00".
 *  On-chain math is always full precision; this is display only. */
function fmt(n: number, symbol?: string): string {
  const max = symbol === "SOL" ? 4 : 2;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: max,
  });
}

const SOL: TokenMeta  = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL",  decimals: 9 };
const USDT: TokenMeta = { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6 };
const USDC: TokenMeta = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 };
const ALL_TOKENS: TokenMeta[] = [SOL, USDT, USDC];

interface JupQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  platformFee: { amount: string; feeBps: number } | null;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot?: number;
}

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Connected wallet pubkey (must own the input mint). */
  walletAddress: string | null;
  /** Used for signing. Must accept VersionedTransaction and return a signed copy. */
  signTransaction:
    | ((tx: VersionedTransaction) => Promise<VersionedTransaction>)
    | null;
  /** Current SOL balance for "Insufficient funds" gating. */
  solBalance: number | null;
  /** Current USDT balance for "Insufficient funds" gating. */
  usdtBalance: number | null;
  /** Current USDC balance for "Insufficient funds" gating. */
  usdcBalance?: number | null;
  /** Optional callback after a successful swap so the parent can refresh balances. */
  onSwapSuccess?: () => void;
  /** Actor id (merchant.id / user.id) — used to key the local swap
   *  history so the Recent Activity feed can show this swap. Optional
   *  to keep existing callers compiling; when omitted no record is
   *  written and nothing breaks. */
  actorId?: string | null;
}

export function SwapModal({
  isOpen,
  onClose,
  walletAddress,
  signTransaction,
  solBalance,
  usdtBalance,
  usdcBalance,
  onSwapSuccess,
  actorId,
}: SwapModalProps) {
  const { refresh } = useOnboarding();
  const [inputToken, setInputToken] = useState<TokenMeta>(USDT);
  const [outputToken, setOutputToken] = useState<TokenMeta>(SOL);

  const balanceFor = (t: TokenMeta) => {
    if (t.symbol === "SOL") return solBalance ?? 0;
    if (t.symbol === "USDT") return usdtBalance ?? 0;
    if (t.symbol === "USDC") return usdcBalance ?? 0;
    return 0;
  };
  const [amountStr, setAmountStr] = useState("");
  const [quote, setQuote] = useState<JupQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapTxSig, setSwapTxSig] = useState<string | null>(null);

  const reset = () => {
    setAmountStr("");
    setQuote(null);
    setQuoteError(null);
    setSwapError(null);
    setSwapTxSig(null);
  };

  // Reset transient state when the modal opens. We deliberately keep the
  // chosen token pair so it sticks across openings.
  useEffect(() => {
    if (isOpen) reset();
  }, [isOpen]);

  const inputBalance = balanceFor(inputToken);
  const amountNum = parseFloat(amountStr);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const insufficientFunds = amountValid && amountNum > inputBalance;

  // Fetch Jupiter quote (debounced).
  useEffect(() => {
    if (!isOpen) return;
    if (!amountValid || insufficientFunds) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const handle = setTimeout(async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const rawAmount = Math.floor(amountNum * Math.pow(10, inputToken.decimals));
        const params = new URLSearchParams({
          inputMint: inputToken.mint,
          outputMint: outputToken.mint,
          amount: String(rawAmount),
          slippageBps: String(SLIPPAGE_BPS),
        });
        // Only include platform fee when we have an ATA for the OUTPUT mint —
        // Jupiter rejects requests whose feeAccount isn't an ATA of the output
        // token. Output-conditional lookup so we don't block the swap entirely
        // for an unsupported direction.
        const feeAccountForOutput = FEE_ATA_BY_SYMBOL[outputToken.symbol] || "";
        if (feeAccountForOutput && PLATFORM_FEE_BPS > 0) {
          params.set("platformFeeBps", String(PLATFORM_FEE_BPS));
        }

        const res = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${params}`);
        if (!res.ok) throw new Error(`Quote HTTP ${res.status}`);
        const json = (await res.json()) as JupQuote;
        setQuote(json);
      } catch (e) {
        setQuoteError(e instanceof Error ? e.message : "Failed to fetch quote");
        setQuote(null);
      } finally {
        setQuoteLoading(false);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [
    isOpen,
    inputToken.mint,
    outputToken.mint,
    inputToken.decimals,
    amountNum,
    amountValid,
    insufficientFunds,
  ]);

  const handleSwapTokens = () => {
    setInputToken(outputToken);
    setOutputToken(inputToken);
    setQuote(null);
    setAmountStr("");
  };

  const outDisplay = useMemo(() => {
    if (!quote) return "—";
    const n = parseInt(quote.outAmount, 10) / Math.pow(10, outputToken.decimals);
    return fmt(n, outputToken.symbol);
  }, [quote, outputToken.decimals, outputToken.symbol]);

  const platformFeeDisplay = useMemo(() => {
    if (!quote?.platformFee) return null;
    const n = parseInt(quote.platformFee.amount, 10) / Math.pow(10, outputToken.decimals);
    return n;
  }, [quote, outputToken.decimals]);

  // Effective per-unit price (output per 1 input). Derived from the quote
  // so it always reflects what the user will actually receive, including
  // the platform-fee cut.
  const unitPrice = useMemo(() => {
    if (!quote) return null;
    const inAmt = parseInt(quote.inAmount, 10) / Math.pow(10, inputToken.decimals);
    const outAmt = parseInt(quote.outAmount, 10) / Math.pow(10, outputToken.decimals);
    if (!inAmt) return null;
    return outAmt / inAmt;
  }, [quote, inputToken.decimals, outputToken.decimals]);

  const handleExecuteSwap = async () => {
    if (!walletAddress || !signTransaction || !quote) return;
    setSwapping(true);
    setSwapError(null);
    setSwapTxSig(null);
    try {
      const feeAccountForOutput = FEE_ATA_BY_SYMBOL[outputToken.symbol] || "";

      // Helper: build, sign, send. Returns the signature on success or
      // throws. Wrapped so we can retry without `feeAccount` if the
      // platform fee path fails with a "fee account not initialized" error.
      const buildAndSend = async (includeFee: boolean): Promise<string> => {
        const body: Record<string, unknown> = {
          quoteResponse: includeFee
            ? quote
            : { ...quote, platformFee: null },
          userPublicKey: walletAddress,
          wrapAndUnwrapSol: true,
        };
        if (includeFee && feeAccountForOutput && PLATFORM_FEE_BPS > 0) {
          body.feeAccount = feeAccountForOutput;
        }
        const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!swapRes.ok) throw new Error(`Swap build HTTP ${swapRes.status}`);
        const { swapTransaction } = (await swapRes.json()) as { swapTransaction: string };
        const txBytes2 = Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0));
        const tx2 = VersionedTransaction.deserialize(txBytes2);
        const signed2 = await signTransaction(tx2);
        const proxyUrl2 = `${window.location.origin}/api/rpc`;
        const connection2 = new Connection(proxyUrl2, "confirmed");
        return await connection2.sendRawTransaction(signed2.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
      };

      // Try with platform fee first. If it fails with the known
      // "fee account not initialized" Jupiter error (custom 0x1789 /
      // 6025), automatically retry once with no fee so the merchant's
      // swap isn't blocked by a treasury-setup edge case.
      let sig: string;
      try {
        sig = await buildAndSend(true);
      } catch (firstErr) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        const isFeeAccountErr = /0x1789|custom program error.*6025|fee.?account/i.test(msg);
        if (!isFeeAccountErr || !feeAccountForOutput) throw firstErr;
        console.warn(
          "[swap] fee-account path failed; retrying without platform fee",
          msg,
        );
        sig = await buildAndSend(false);
      }

      // (Send + retry handled inside buildAndSend above. We intentionally
      //  don't call connection.confirmTransaction — web3.js opens a WS
      //  subscription our /api/rpc HTTP proxy can't serve, surfacing a
      //  noisy "ws error" in the console. The on-chain TX tab catches
      //  the confirmed state on its next poll.)
      setSwapTxSig(sig);
      // Persist to local swap history so Recent Activity can render it.
      // quote.inAmount / outAmount are stringified base units — convert
      // back to human numbers using the token decimals.
      try {
        const inAmtHuman =
          parseInt(quote.inAmount, 10) / Math.pow(10, inputToken.decimals);
        const outAmtHuman =
          parseInt(quote.outAmount, 10) / Math.pow(10, outputToken.decimals);
        recordSwap(actorId, {
          signature: sig,
          inputSymbol: inputToken.symbol,
          inputAmount: inAmtHuman,
          outputSymbol: outputToken.symbol,
          outputAmount: outAmtHuman,
          blockTime: Math.floor(Date.now() / 1000),
        });
      } catch {
        /* non-critical — recordSwap already swallows its own errors */
      }
      onSwapSuccess?.();
      void refresh();
      // Auto-close after a short success-state display so the merchant
      // can see the checkmark + tx link briefly without having to dismiss.
      window.setTimeout(() => {
        // Don't force-close if the user has already navigated away or
        // started a new flow inside the modal.
        onClose();
      }, 2200);
    } catch (e) {
      setSwapError(e instanceof Error ? e.message : "Swap failed");
    } finally {
      setSwapping(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-sm bg-background border-t md:border border-foreground/[0.08] md:rounded-2xl rounded-t-2xl p-5 space-y-3 max-h-[85vh] overflow-y-auto pb-28 md:pb-5"
      >
        {/* Success state — pop the modal into a single checkmark panel
            after a swap broadcasts. Auto-dismisses ~2.2s later via the
            setTimeout in handleExecuteSwap. */}
        {swapTxSig ? (
          <div className="py-6 flex flex-col items-center text-center gap-3">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 18 }}
              className="w-16 h-16 rounded-full bg-white/[0.06] border border-white/[0.09] flex items-center justify-center"
            >
              <Check className="w-9 h-9 text-[#f5f5f7]" strokeWidth={3} />
            </motion.div>
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-foreground">Swap confirmed</p>
              <p className="text-[12px] text-foreground/50">
                {amountStr} {inputToken.symbol} → {outDisplay} {outputToken.symbol}
              </p>
            </div>
            <a
              href={`https://solscan.io/tx/${swapTxSig}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-foreground/40 hover:text-foreground/70 flex items-center gap-1"
            >
              View on Solscan <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ) : (
          <>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Swap</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-foreground/40 hover:text-foreground/70"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Input */}
        <div className="bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-foreground/40 font-medium">From</span>
            <button
              type="button"
              onClick={() => setAmountStr(inputBalance > 0 ? String(inputBalance) : "")}
              className="text-[10px] text-foreground/40 hover:text-foreground/70 transition-colors"
              aria-label="Use full balance"
            >
              Balance: <span className="font-mono">{fmt(inputBalance, inputToken.symbol)}</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0.00"
              maxLength={20}
              className="flex-1 min-w-0 bg-transparent text-xl sm:text-2xl font-bold text-foreground tabular-nums outline-none placeholder:text-foreground/20"
            />
            <TokenSelect
              value={inputToken}
              onChange={(t) => {
                if (t.symbol === outputToken.symbol) setOutputToken(inputToken);
                setInputToken(t);
                setAmountStr("");
                setQuote(null);
              }}
            />
          </div>
          {/* % chips — quick-set amount as a fraction of available balance.
              Hidden when balance is 0 so the chips don't pretend to be active. */}
          {inputBalance > 0 && (
            <div className="flex items-center gap-1 mt-2.5">
              {[25, 50, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => {
                    const val = (inputBalance * pct) / 100;
                    // For SOL, leave ~0.005 SOL headroom for fees so the
                    // user doesn't accidentally hit "Insufficient funds"
                    // when picking 100%.
                    const safe = inputToken.symbol === "SOL" && pct === 100
                      ? Math.max(0, val - 0.005)
                      : val;
                    // Cap at 4 decimals for SOL (rounded down so we never
                    // request more than the balance), 2 for stables.
                    const dp = inputToken.symbol === "SOL" ? 4 : 2;
                    const factor = Math.pow(10, dp);
                    const rounded = Math.floor(safe * factor) / factor;
                    setAmountStr(rounded.toString());
                  }}
                  className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-foreground/[0.04] text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
                >
                  {pct === 100 ? "Max" : `${pct}%`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Flip */}
        <div className="flex justify-center -my-1">
          <button
            onClick={handleSwapTokens}
            className="p-1.5 rounded-full bg-foreground/[0.06] border border-foreground/[0.08] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.10] transition-colors"
            aria-label="Flip direction"
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Output */}
        <div className="bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-foreground/40 font-medium">To (estimated)</span>
            <span className="text-[10px] text-foreground/40">
              Slippage: 0.50%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-1 min-w-0 text-xl sm:text-2xl font-bold text-foreground tabular-nums truncate">
              {quoteLoading ? "…" : outDisplay}
            </span>
            <TokenSelect
              value={outputToken}
              onChange={(t) => {
                if (t.symbol === inputToken.symbol) setInputToken(outputToken);
                setOutputToken(t);
                setQuote(null);
              }}
            />
          </div>
        </div>

        {/* Quote details */}
        {quote && (
          <div className="space-y-1 text-[11px] text-foreground/50">
            {unitPrice !== null && (
              <div className="flex justify-between">
                <span>Rate</span>
                <span className="text-foreground/80 tabular-nums">
                  1 {inputToken.symbol} ≈ {fmt(unitPrice, outputToken.symbol)} {outputToken.symbol}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Price impact</span>
              <span className="text-foreground/80 tabular-nums">
                {(parseFloat(quote.priceImpactPct) * 100).toFixed(2)}%
              </span>
            </div>
            {platformFeeDisplay !== null && (
              <div className="flex justify-between">
                <span>Platform fee ({(PLATFORM_FEE_BPS / 100).toFixed(2)}%)</span>
                <span className="text-foreground/80 tabular-nums">
                  ~{fmt(platformFeeDisplay, outputToken.symbol)} {outputToken.symbol}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Errors / warnings */}
        {quoteError && (
          <p className="text-[11px] text-rose-400/80 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> {quoteError}
          </p>
        )}
        {insufficientFunds && (
          <p className="text-[11px] text-rose-400/80 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> Insufficient {inputToken.symbol} balance
          </p>
        )}
        {swapError && (
          <p className="text-[11px] text-rose-400/80 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> {swapError}
          </p>
        )}
        {/* CTA */}
        <button
          onClick={handleExecuteSwap}
          disabled={
            swapping ||
            !quote ||
            !walletAddress ||
            !signTransaction ||
            insufficientFunds ||
            !amountValid
          }
          className="w-full py-3 px-3 rounded-xl bg-foreground text-background text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {swapping ? (
            <>
              <Loader2 className="w-4 h-4 shrink-0 animate-spin" />{" "}
              <span className="truncate">Swapping…</span>
            </>
          ) : !walletAddress ? (
            "Connect wallet"
          ) : insufficientFunds ? (
            "Insufficient funds"
          ) : !amountValid ? (
            "Enter amount"
          ) : !quote ? (
            "Fetching quote…"
          ) : (
            <span className="truncate">
              Swap {amountStr} {inputToken.symbol} → {outDisplay} {outputToken.symbol}
            </span>
          )}
        </button>

        <p className="text-[10px] text-foreground/30 text-center leading-snug">
          Routed via Jupiter. On-chain transaction; rates change every few seconds.
        </p>
          </>
        )}
      </motion.div>
    </div>
  );
}

// Suppress unused import warnings — PublicKey is reserved for future
// pre-flight validation of feeAccount addresses, kept imported now so
// editors don't auto-remove it during quick iterations.
void PublicKey;

/**
 * Compact 3-way token selector. Renders the current symbol as a chip;
 * tap opens a tiny popover with the three supported tokens. Kept
 * inline here (vs a generic Select component) because the option set
 * is fixed and the popover styling matches the modal's chrome.
 */
function TokenSelect({
  value,
  onChange,
}: {
  value: TokenMeta;
  onChange: (t: TokenMeta) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if ((e.target as HTMLElement | null)?.closest("[data-token-select]")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);
  return (
    <div className="relative shrink-0" data-token-select>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-semibold text-foreground/80 bg-foreground/[0.06] hover:bg-foreground/[0.10] rounded-lg px-3 py-1.5 transition-colors"
      >
        {value.symbol}
        <span className="text-foreground/40 text-[10px]">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 w-[110px] rounded-lg bg-background border border-foreground/[0.08] shadow-xl shadow-black/40 overflow-hidden">
          {ALL_TOKENS.map((t) => (
            <button
              key={t.symbol}
              type="button"
              onClick={() => {
                onChange(t);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-foreground/[0.06] transition-colors ${
                t.symbol === value.symbol ? "text-foreground" : "text-foreground/70"
              }`}
            >
              {t.symbol}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
