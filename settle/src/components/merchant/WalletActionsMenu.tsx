"use client";

/**
 * Self-contained wallet management menu: a gear icon that opens a
 * dropdown with Export Private Key / Download Backup / Delete Wallet /
 * Init Fee Accounts. Each action is handled inline (no navigation to
 * the wallet page) and owns its own modal panel.
 *
 * Designed to drop into any layout — the mobile home card AND the
 * desktop StatusCard render the same component so we don't duplicate
 * the password / confirmation / toast UI in two places. Two instances
 * end up mounted on the page but only one is visible at a time
 * (responsive show/hide on the parent) — modal renders are fixed at
 * z-50 so collisions can't happen in practice.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Settings,
  Key,
  Download,
  Trash2,
  Check,
  Copy,
  X,
  Loader2,
} from "lucide-react";
import {
  loadEncryptedWallet,
  decryptWallet,
  exportPrivateKey,
  clearEncryptedWallet,
  clearSessionKeypair,
} from "@/lib/wallet/embeddedWallet";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { copyToClipboard } from "@/lib/clipboard";
import { useSolanaWallet } from "@/context/SolanaWalletContext";
import type { Transaction } from "@solana/web3.js";

type WalletActionKind = "export" | "backup";

interface WalletActionsMenuProps {
  /** Authenticated actor id (merchant.id / user.id) — used as the per-actor
   *  storage key for the encrypted wallet blob. */
  actorId: string | undefined;
  /** Optional class hook for the trigger button's outer wrapper. */
  className?: string;
}

export function WalletActionsMenu({
  actorId,
  className,
}: WalletActionsMenuProps) {
  // Pull wallet handles from context so callers don't have to thread
  // walletAddress / signTransaction props through every layout level.
  const solanaWallet = useSolanaWallet();
  const walletAddress = solanaWallet?.walletAddress ?? null;
  const signTransaction = (solanaWallet as { signTransaction?: (tx: Transaction) => Promise<Transaction> })?.signTransaction ?? null;
  // ── menu open/close ───────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-wallet-actions-menu]")) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // ── export / backup (password-gated) ──────────────────────────────
  const [walletAction, setWalletAction] = useState<WalletActionKind | null>(null);
  const [walletActionPw, setWalletActionPw] = useState("");
  const [walletActionLoading, setWalletActionLoading] = useState(false);
  const [walletActionError, setWalletActionError] = useState<string | null>(null);
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [exportedKeyCopied, setExportedKeyCopied] = useState(false);

  const resetWalletActionModal = () => {
    setWalletAction(null);
    setWalletActionPw("");
    setWalletActionError(null);
    setExportedKey(null);
    setExportedKeyCopied(false);
    setWalletActionLoading(false);
  };

  const runWalletAction = async () => {
    if (!walletAction || !actorId) return;
    setWalletActionLoading(true);
    setWalletActionError(null);
    try {
      const blob = loadEncryptedWallet(actorId);
      if (!blob) {
        setWalletActionError("No encrypted wallet found on this device.");
        return;
      }
      // Fresh helper fetch on every attempt so a stale value can't lock
      // the user out (v3 blobs require the per-actor server helper).
      let helper: string | null = null;
      try {
        const res = await fetchWithAuth("/api/wallet/unlock-helper");
        if (res.ok) helper = (await res.json())?.data?.unlock_helper ?? null;
      } catch {
        /* helper is optional for v1/v2 blobs */
      }

      const kp = await decryptWallet(blob, walletActionPw.trim(), helper);
      if (walletAction === "export") {
        setExportedKey(exportPrivateKey(kp));
      } else if (walletAction === "backup") {
        const key = exportPrivateKey(kp);
        const fileBlob = new Blob(
          [
            `Blip Money — Wallet Backup\n\nPublic Key: ${kp.publicKey.toBase58()}\nPrivate Key: ${key}\n\nKeep this file safe. Anyone with the private key can access your funds.\nExported: ${new Date().toISOString()}\n`,
          ],
          { type: "text/plain" },
        );
        const url = URL.createObjectURL(fileBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `blip-wallet-backup-${kp.publicKey.toBase58().slice(0, 8)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resetWalletActionModal();
      }
    } catch (err) {
      setWalletActionError(
        err instanceof Error
          ? /decrypt|password/i.test(err.message)
            ? "Wrong password. Try again."
            : err.message
          : "Failed to unlock wallet.",
      );
    } finally {
      setWalletActionLoading(false);
    }
  };

  // ── delete wallet ─────────────────────────────────────────────────
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const handleDeleteWallet = () => {
    if (!actorId) return;
    clearSessionKeypair(actorId);
    clearEncryptedWallet(actorId);
    setDeleteConfirmOpen(false);
    // Reload so EmbeddedWalletContext re-probes from a clean slate.
    if (typeof window !== "undefined") window.location.reload();
  };

  // ── init fee accounts (admin one-time) ────────────────────────────
  const [initFeesState, setInitFeesState] = useState<
    | { stage: "idle" }
    | { stage: "running" }
    | { stage: "done"; sig: string }
    | { stage: "error"; message: string }
  >({ stage: "idle" });
  const [feeAtasReady, setFeeAtasReady] = useState<boolean | null>(null);

  // Probe on mount: are both treasury ATAs (wSOL + USDC) live? Used to
  // auto-hide the Init Fee Accounts menu item once it has no work left.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/rpc", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getMultipleAccounts",
            params: [
              [
                "85usXNGrscbDRRkv2q6gj4EgE96eVi4Uv62vnPSugft", // wSOL ATA
                "FTQbL7yU8ajYuTEWRcqsjkMKfUD2v4gRYRZMK2zX5EmK", // USDC ATA
              ],
              { encoding: "base64" },
            ],
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        const values = (json?.result?.value ?? []) as Array<unknown>;
        setFeeAtasReady(values.length === 2 && values.every((v) => v !== null));
      } catch {
        if (!cancelled) setFeeAtasReady(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (initFeesState.stage === "done") setFeeAtasReady(true);
  }, [initFeesState.stage]);

  const handleInitFeeAccounts = async () => {
    if (!walletAddress || !signTransaction) {
      setInitFeesState({ stage: "error", message: "Connect your wallet first." });
      return;
    }
    setInitFeesState({ stage: "running" });
    try {
      const [
        { Connection, PublicKey, Transaction: Tx },
        { createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID },
      ] = await Promise.all([
        import("@solana/web3.js"),
        import("@solana/spl-token"),
      ]);
      const TREASURY = new PublicKey("D3oNcCQ7yareg3UkzK7AQ4qk8oax9AbkZFVJcakD9vSP");
      const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
      const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
      const WSOL_ATA = new PublicKey("85usXNGrscbDRRkv2q6gj4EgE96eVi4Uv62vnPSugft");
      const USDC_ATA = new PublicKey("FTQbL7yU8ajYuTEWRcqsjkMKfUD2v4gRYRZMK2zX5EmK");
      const payer = new PublicKey(walletAddress);

      const tx = new Tx();
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer, WSOL_ATA, TREASURY, WSOL_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer, USDC_ATA, TREASURY, USDC_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );

      const connection = new Connection(`${window.location.origin}/api/rpc`, "confirmed");
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer;

      const signed = await signTransaction(tx as unknown as Transaction);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      setInitFeesState({ stage: "done", sig });
    } catch (err) {
      setInitFeesState({
        stage: "error",
        message: err instanceof Error ? err.message : "Init failed",
      });
    }
  };

  // ── menu items ────────────────────────────────────────────────────
  const menuItems = [
    { Icon: Key, label: "Export Private Key", action: "export" as const },
    { Icon: Download, label: "Download Backup", action: "backup" as const },
    ...(feeAtasReady === true
      ? []
      : [{ Icon: Settings, label: "Init Fee Accounts (admin)", action: "init-fees" as const }]),
    { Icon: Trash2, label: "Delete Wallet", danger: true as const, action: "delete" as const },
  ];

  return (
    <>
      <div className={`relative ${className ?? ""}`} data-wallet-actions-menu>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="p-1.5 rounded-lg text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.04] transition-colors"
          aria-label="Wallet settings"
          aria-expanded={menuOpen}
        >
          <Settings className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 z-20 w-[200px] rounded-xl bg-background border border-foreground/[0.08] shadow-xl shadow-black/30 overflow-hidden"
            role="menu"
          >
            {menuItems.map(({ Icon, label, action, danger }) => (
              <button
                key={label}
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  if (action === "export" || action === "backup") {
                    setWalletAction(action);
                  } else if (action === "init-fees") {
                    handleInitFeeAccounts();
                  } else if (action === "delete") {
                    setDeleteConfirmOpen(true);
                  }
                }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium hover:bg-foreground/[0.04] transition-colors ${
                  danger ? "text-rose-400/90" : "text-foreground/80"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Export / Backup modal (password-gated) */}
      {walletAction && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={resetWalletActionModal}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full md:max-w-sm bg-background border-t md:border border-foreground/[0.08] md:rounded-2xl rounded-t-2xl p-5 space-y-3 max-h-[85vh] overflow-y-auto pb-28 md:pb-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">
                {walletAction === "export" ? "Export Private Key" : "Download Backup"}
              </h3>
              <button
                onClick={resetWalletActionModal}
                className="p-1 rounded-lg text-foreground/40 hover:text-foreground/70"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {exportedKey ? (
              <>
                <p className="text-[12px] text-foreground/60">
                  Anyone with this key can drain your wallet. Copy it somewhere safe — never share it.
                </p>
                <div className="bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg p-3 break-all text-[11px] font-mono text-foreground/90">
                  {exportedKey}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await copyToClipboard(exportedKey);
                      setExportedKeyCopied(true);
                      setTimeout(() => setExportedKeyCopied(false), 1400);
                    }}
                    className="flex-1 py-2.5 rounded-lg bg-foreground text-background text-[12px] font-semibold flex items-center justify-center gap-1.5"
                  >
                    {exportedKeyCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {exportedKeyCopied ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={resetWalletActionModal}
                    className="flex-1 py-2.5 rounded-lg bg-foreground/[0.05] border border-foreground/[0.08] text-foreground/70 text-[12px] font-semibold"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[12px] text-foreground/50">
                  {walletAction === "export"
                    ? "Enter your wallet password to reveal your private key."
                    : "Enter your wallet password to download an encrypted backup file."}
                </p>
                <input
                  type="password"
                  value={walletActionPw}
                  onChange={(e) => setWalletActionPw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !walletActionLoading && walletActionPw.length > 0)
                      runWalletAction();
                  }}
                  placeholder="Wallet password"
                  maxLength={100}
                  autoFocus
                  className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-foreground/30 focus:outline-none focus:border-foreground/30"
                />
                {walletActionError && (
                  <p className="text-[11px] text-rose-400">{walletActionError}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={resetWalletActionModal}
                    disabled={walletActionLoading}
                    className="flex-1 py-2.5 rounded-lg bg-foreground/[0.05] border border-foreground/[0.08] text-foreground/70 text-[12px] font-semibold disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={runWalletAction}
                    disabled={walletActionLoading || walletActionPw.length === 0}
                    className="flex-1 py-2.5 rounded-lg bg-foreground text-background text-[12px] font-semibold disabled:opacity-40"
                  >
                    {walletActionLoading
                      ? "Unlocking…"
                      : walletAction === "export"
                        ? "Reveal Key"
                        : "Download"}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setDeleteConfirmOpen(false)}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full md:max-w-sm bg-background border-t md:border border-foreground/[0.08] md:rounded-2xl rounded-t-2xl p-5 pb-28 md:pb-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-rose-400">Delete Wallet</h3>
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                className="p-1 rounded-lg text-foreground/40 hover:text-foreground/70"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[12px] text-foreground/60 leading-relaxed">
              This removes the encrypted wallet from this device. Without your
              <strong className="text-foreground"> 12-word recovery phrase</strong> or
              <strong className="text-foreground"> exported private key</strong>, the funds
              become permanently inaccessible. There is no recovery from Blip.
            </p>
            <div className="bg-rose-500/[0.08] border border-rose-500/20 rounded-lg p-3 text-[11px] text-rose-400/90 flex items-start gap-2">
              <span className="text-base leading-none">⚠️</span>
              <span>Make sure you have your recovery phrase saved before continuing.</span>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-lg bg-foreground/[0.05] border border-foreground/[0.08] text-foreground/70 text-[12px] font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteWallet}
                className="flex-1 py-2.5 rounded-lg bg-rose-500/90 hover:bg-rose-500 text-white text-[12px] font-bold"
              >
                Delete Forever
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Init-fee-accounts toast */}
      {initFeesState.stage !== "idle" && (
        <div
          className="fixed bottom-20 inset-x-4 z-[60] md:inset-x-auto md:right-4 md:max-w-sm rounded-xl bg-foreground text-background p-3 shadow-xl shadow-black/40 flex items-start gap-2 cursor-pointer"
          onClick={() => setInitFeesState({ stage: "idle" })}
        >
          {initFeesState.stage === "running" ? (
            <>
              <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin" />
              <div className="text-[12px]">
                <p className="font-bold">Initializing fee accounts…</p>
                <p className="opacity-70 text-[10px]">
                  Sign in your wallet and wait for confirmation.
                </p>
              </div>
            </>
          ) : initFeesState.stage === "done" ? (
            <>
              <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
              <div className="text-[12px] min-w-0">
                <p className="font-bold">Fee accounts initialized</p>
                <p className="opacity-70 text-[10px] truncate">
                  Future SOL & USDC swaps will pay 0.5% to treasury.{" "}
                  <a
                    href={`https://solscan.io/tx/${initFeesState.sig}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="underline"
                  >
                    View tx
                  </a>
                </p>
              </div>
            </>
          ) : (
            <>
              <X className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
              <div className="text-[12px] min-w-0">
                <p className="font-bold">Init failed</p>
                <p className="opacity-70 text-[10px] line-clamp-2">
                  {initFeesState.message}
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
