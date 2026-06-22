"use client";

/**
 * Send modal — outbound transfers of SOL / USDT / USDC from the
 * merchant's connected (embedded) wallet to any Solana address.
 *
 * Safety:
 *   - Recipient is validated as a real Solana PublicKey before
 *     anything is built. Bad input never reaches the network.
 *   - For SPL tokens we use `createAssociatedTokenAccountIdempotentInstruction`,
 *     so sending to an address that has never received the token still
 *     works — the ATA gets created in the same transaction (payer = sender).
 *   - Hard "you can't send more than you have" gate. We reserve ~0.005
 *     SOL when computing Max-SOL so the user doesn't fail at sign time
 *     due to fees + rent.
 *   - Tx is signed by the embedded wallet's `signTransaction` adapter
 *     (NOT by reading the keypair here), so the secret never leaves the
 *     context that owns it.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  X,
  ArrowUpRight,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Check,
} from "lucide-react";
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { getUsdtMint } from "@/lib/solana/v2/config";

// ── Token catalogue ─────────────────────────────────────────────────
interface TokenMeta {
  symbol: "SOL" | "USDT" | "USDC";
  mint: PublicKey | null; // null = native SOL
  decimals: number;
}
const SOL: TokenMeta = { symbol: "SOL", mint: null, decimals: 9 };
const USDT: TokenMeta = {
  symbol: "USDT",
  // Network-aware: devnet -> our test mint (5AzTK6…), mainnet -> real USDT.
  // Hardcoding the mainnet mint broke devnet sends (that address is a plain
  // System account on devnet → ATA create fails with IncorrectProgramId).
  mint: getUsdtMint(),
  decimals: 6,
};
const USDC: TokenMeta = {
  symbol: "USDC",
  mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  decimals: 6,
};
const TOKENS = [USDT, USDC, SOL];

/** Display amounts: 2 decimals for stables, up to 4 for SOL. Matches
 *  the formatter used in SwapModal so the two flows feel consistent. */
function fmt(n: number, symbol: TokenMeta["symbol"]): string {
  const max = symbol === "SOL" ? 4 : 2;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: max,
  });
}

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string | null;
  /** Signs a legacy Transaction in place (returns the signed copy). */
  signTransaction:
    | ((tx: Transaction) => Promise<Transaction>)
    | null;
  solBalance: number | null;
  usdtBalance: number | null;
  usdcBalance?: number | null;
  /** Fires after a successful broadcast so the parent can refresh balances. */
  onSendSuccess?: () => void;
}

export function SendModal({
  isOpen,
  onClose,
  walletAddress,
  signTransaction,
  solBalance,
  usdtBalance,
  usdcBalance,
  onSendSuccess,
}: SendModalProps) {
  const [token, setToken] = useState<TokenMeta>(USDT);
  const [recipient, setRecipient] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRecipient("");
      setAmountStr("");
      setError(null);
      setTxSig(null);
      setSending(false);
    }
  }, [isOpen]);

  const balanceFor = (t: TokenMeta): number => {
    if (t.symbol === "SOL") return solBalance ?? 0;
    if (t.symbol === "USDT") return usdtBalance ?? 0;
    if (t.symbol === "USDC") return usdcBalance ?? 0;
    return 0;
  };
  const balance = balanceFor(token);

  const amountNum = parseFloat(amountStr);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const insufficient = amountValid && amountNum > balance;

  const recipientValid = useMemo(() => {
    const trimmed = recipient.trim();
    if (!trimmed) return false;
    try {
      const pk = new PublicKey(trimmed);
      return pk.toBase58() === trimmed;
    } catch {
      return false;
    }
  }, [recipient]);

  const sendingToSelf =
    recipientValid && walletAddress && recipient.trim() === walletAddress;

  const canSend =
    !sending &&
    !!walletAddress &&
    !!signTransaction &&
    amountValid &&
    !insufficient &&
    recipientValid &&
    !sendingToSelf;

  const handleSend = async () => {
    if (!walletAddress || !signTransaction || !recipientValid) return;
    setSending(true);
    setError(null);
    setTxSig(null);
    try {
      const sender = new PublicKey(walletAddress);
      const recipientPk = new PublicKey(recipient.trim());

      const proxyUrl = `${window.location.origin}/api/rpc`;
      const connection = new Connection(proxyUrl, "confirmed");

      const tx = new Transaction();

      if (token.symbol === "SOL") {
        const lamports = Math.floor(amountNum * LAMPORTS_PER_SOL);
        tx.add(
          SystemProgram.transfer({
            fromPubkey: sender,
            toPubkey: recipientPk,
            lamports,
          }),
        );
      } else if (token.mint) {
        const mint = token.mint;
        const senderAta = getAssociatedTokenAddressSync(
          mint,
          sender,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        const recipientAta = getAssociatedTokenAddressSync(
          mint,
          recipientPk,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        // Idempotent ATA create — no-op if it already exists. Pays
        // ~0.002 SOL rent if recipient has never received this token.
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            sender, // payer
            recipientAta,
            recipientPk, // owner
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
        const rawAmount = BigInt(
          Math.floor(amountNum * Math.pow(10, token.decimals)),
        );
        tx.add(
          createTransferCheckedInstruction(
            senderAta,
            mint,
            recipientAta,
            sender,
            rawAmount,
            token.decimals,
            [],
            TOKEN_PROGRAM_ID,
          ),
        );
      }

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = sender;

      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      setTxSig(sig);
      onSendSuccess?.();
      window.setTimeout(() => onClose(), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const setMax = () => {
    if (!balance || balance <= 0) return;
    // SOL needs a fee/rent buffer or the user will fail at sign time.
    const reserve = token.symbol === "SOL" ? 0.005 : 0;
    const usable = Math.max(0, balance - reserve);
    const dp = token.symbol === "SOL" ? 4 : 2;
    const factor = Math.pow(10, dp);
    const rounded = Math.floor(usable * factor) / factor;
    setAmountStr(rounded.toString());
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
        {txSig ? (
          // ── Success panel — multi-stage entrance, ambient glow,
          //    SVG check stroke draw-in, staggered text reveals.
          <div className="relative py-8 flex flex-col items-center text-center gap-4 overflow-hidden">
            {/* Ambient glow — softly pulses behind the check */}
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full bg-white/[0.06] blur-3xl"
            />

            {/* Outer pulse ring */}
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: [0.4, 1.15, 1], opacity: [0, 0.6, 0] }}
              transition={{ duration: 1.1, times: [0, 0.5, 1], ease: "easeOut" }}
              className="pointer-events-none absolute top-8 w-24 h-24 rounded-full border-2 border-white/[0.09]"
            />

            {/* Check disc */}
            <motion.div
              initial={{ scale: 0, rotate: -30, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 14, delay: 0.05 }}
              className="relative w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/40 flex items-center justify-center"
            >
              {/* SVG check with stroke draw-in */}
              <svg viewBox="0 0 40 40" className="w-12 h-12">
                <motion.path
                  d="M8 21 L17 30 L33 12"
                  fill="none"
                  stroke="white"
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.45, delay: 0.25, ease: "easeOut" }}
                />
              </svg>
            </motion.div>

            {/* Amount + recipient — staggered reveal */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.55, ease: "easeOut" }}
              className="space-y-1"
            >
              <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/40 font-semibold">
                Transfer complete
              </p>
              <p className="text-3xl font-bold text-foreground tabular-nums">
                {fmt(amountNum, token.symbol)}{" "}
                <span className="text-foreground/40 text-xl font-semibold">
                  {token.symbol}
                </span>
              </p>
            </motion.div>

            {/* Recipient pill */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.7, ease: "easeOut" }}
              className="flex items-center gap-2 bg-foreground/[0.04] border border-foreground/[0.08] rounded-full px-3 py-1.5"
            >
              <span className="text-[10px] uppercase tracking-wider text-foreground/40 font-medium">
                To
              </span>
              <span className="text-[12px] font-mono text-foreground/80">
                {recipient.slice(0, 4)}…{recipient.slice(-4)}
              </span>
            </motion.div>

            {/* Tx link */}
            <motion.a
              href={`https://solscan.io/tx/${txSig}`}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.95 }}
              className="text-[11px] text-foreground/40 hover:text-foreground transition-colors flex items-center gap-1"
            >
              View on Solscan <ExternalLink className="w-3 h-3" />
            </motion.a>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">Send</h3>
              <button
                onClick={onClose}
                className="p-1 rounded-lg text-foreground/40 hover:text-foreground/70"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Token picker */}
            <div className="flex items-center gap-1 bg-foreground/[0.04] rounded-lg p-0.5">
              {TOKENS.map((t) => (
                <button
                  key={t.symbol}
                  type="button"
                  onClick={() => {
                    setToken(t);
                    setAmountStr("");
                  }}
                  className={`flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-md transition-colors ${
                    token.symbol === t.symbol
                      ? "bg-foreground/[0.10] text-foreground"
                      : "text-foreground/40 hover:text-foreground/70"
                  }`}
                >
                  {t.symbol}
                </button>
              ))}
            </div>

            {/* Recipient */}
            <div className="bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl p-3 space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-foreground/40 font-medium">
                Recipient
              </span>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Solana address"
                maxLength={44}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full bg-transparent text-[12px] font-mono text-foreground outline-none placeholder:text-foreground/30"
              />
              {recipient && !recipientValid && (
                <p className="text-[11px] text-rose-400/80 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" /> Not a valid Solana address
                </p>
              )}
              {sendingToSelf && (
                <p className="text-[11px] text-amber-400/80 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" /> Recipient is your own wallet
                </p>
              )}
            </div>

            {/* Amount */}
            <div className="bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-foreground/40 font-medium">
                  Amount
                </span>
                <button
                  type="button"
                  onClick={setMax}
                  className="text-[10px] text-foreground/40 hover:text-foreground/70 transition-colors"
                >
                  Balance: <span className="font-mono">{fmt(balance, token.symbol)}</span>
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
                  className="flex-1 min-w-0 bg-transparent text-2xl font-bold text-foreground tabular-nums outline-none placeholder:text-foreground/20"
                />
                <span className="shrink-0 text-sm font-semibold text-foreground/80 bg-foreground/[0.06] rounded-lg px-3 py-1.5">
                  {token.symbol}
                </span>
              </div>
              {balance > 0 && (
                <div className="flex items-center gap-1 mt-2.5">
                  {[25, 50, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        const val = (balance * pct) / 100;
                        const reserve = token.symbol === "SOL" && pct === 100 ? 0.005 : 0;
                        const safe = Math.max(0, val - reserve);
                        const dp = token.symbol === "SOL" ? 4 : 2;
                        const factor = Math.pow(10, dp);
                        setAmountStr((Math.floor(safe * factor) / factor).toString());
                      }}
                      className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-foreground/[0.04] text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
                    >
                      {pct === 100 ? "Max" : `${pct}%`}
                    </button>
                  ))}
                </div>
              )}
              {insufficient && (
                <p className="mt-2 text-[11px] text-rose-400/80 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" /> Insufficient {token.symbol} balance
                </p>
              )}
            </div>

            {error && (
              <p className="text-[11px] text-rose-400/80 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" /> {error}
              </p>
            )}

            <button
              onClick={handleSend}
              disabled={!canSend}
              className="w-full py-3 rounded-xl bg-foreground text-background text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {sending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Sending…
                </>
              ) : !walletAddress ? (
                "Connect wallet"
              ) : !recipientValid ? (
                "Enter recipient"
              ) : !amountValid ? (
                "Enter amount"
              ) : insufficient ? (
                "Insufficient funds"
              ) : sendingToSelf ? (
                "Recipient is your wallet"
              ) : (
                `Send ${amountStr} ${token.symbol}`
              )}
            </button>

            <p className="text-[10px] text-foreground/30 text-center leading-snug">
              Solana mainnet. Double-check the address — on-chain transfers are irreversible.
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
