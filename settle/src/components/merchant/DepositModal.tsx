"use client";

/**
 * Deposit modal — shows the merchant's Solana wallet address as a QR
 * code + plain-text address with a copy button. Used so users can
 * scan and send USDT / USDC / SOL directly to this wallet (no
 * blip-side accounting involved; on-chain receive is on-chain receive).
 *
 * Renders only when `isOpen && walletAddress`; the QR is generated
 * lazily with the `qrcode` library, mirroring how
 * src/components/user/screens/HomeScreen.tsx does the user-side QR.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import * as QRCode from "qrcode";
import { X, Copy, Check, ExternalLink, ArrowDownToLine } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { CrossChainDepositModal } from "@/components/wallet/CrossChainDepositModal";

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string | null;
}

type DepositTab = "solana" | "cross-chain";

export function DepositModal({ isOpen, onClose, walletAddress }: DepositModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Tabs: Solana (default — the existing QR/address flow) vs cross-chain
  // (LI.FI). Cross-chain renders its own dedicated modal so the QR
  // modal stays focused; flipping the tab just toggles which one is
  // showing without losing the open state of the parent.
  const [tab, setTab] = useState<DepositTab>("solana");
  useEffect(() => {
    if (isOpen) setTab("solana");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !walletAddress) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(walletAddress, {
      width: 240,
      margin: 1,
      color: { dark: "#FFFFFF", light: "#00000000" }, // white QR on transparent
      errorCorrectionLevel: "M",
    })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [isOpen, walletAddress]);

  if (!isOpen) return null;

  // Cross-chain mode: hand off to the dedicated modal. The parent
  // (this component) stays mounted so flipping back to "Solana" keeps
  // the QR generation cache warm.
  if (tab === "cross-chain") {
    return (
      <CrossChainDepositModal
        isOpen={true}
        onClose={onClose}
        destinationAddress={walletAddress}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-sm bg-background border-t md:border border-foreground/[0.08] md:rounded-2xl rounded-t-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto pb-28 md:pb-5"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Deposit</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-foreground/40 hover:text-foreground/70"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher — "Solana" (this QR flow) vs "From another
            chain" (LI.FI bridge). The latter swaps in a different
            modal entirely so we don't shoehorn a chain picker into
            the QR layout. */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-foreground/[0.04] border border-foreground/[0.06]">
          <button
            onClick={() => setTab("solana")}
            className="py-2 rounded-lg text-[11px] font-semibold transition-colors bg-foreground/[0.08] text-foreground"
          >
            Solana
          </button>
          <button
            onClick={() => setTab("cross-chain")}
            className="py-2 rounded-lg text-[11px] font-semibold transition-colors text-foreground/50 hover:text-foreground/80 flex items-center justify-center gap-1.5"
          >
            <ArrowDownToLine className="w-3 h-3" />
            From another chain
          </button>
        </div>

        {!walletAddress ? (
          <p className="text-[12px] text-foreground/50 text-center py-8">
            Wallet not ready. Connect or unlock first.
          </p>
        ) : (
          <>
            {/* QR */}
            <div className="flex justify-center">
              <div className="bg-foreground/[0.04] border border-foreground/[0.08] rounded-2xl p-4">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrDataUrl}
                    alt="Wallet address QR code"
                    width={240}
                    height={240}
                    className="block"
                  />
                ) : (
                  <div className="w-[240px] h-[240px] flex items-center justify-center text-[11px] text-foreground/40">
                    Generating…
                  </div>
                )}
              </div>
            </div>

            {/* Address + copy */}
            <button
              onClick={async () => {
                await copyToClipboard(walletAddress);
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
              className="w-full flex items-center gap-2 bg-foreground/[0.04] hover:bg-foreground/[0.06] border border-foreground/[0.08] rounded-xl p-3 transition-colors"
            >
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[10px] uppercase tracking-wider text-foreground/40 font-medium mb-0.5">
                  Wallet Address
                </p>
                <p className="text-[12px] font-mono text-foreground/80 break-all">
                  {walletAddress}
                </p>
              </div>
              {copied ? (
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <Copy className="w-4 h-4 text-foreground/40 shrink-0" />
              )}
            </button>

            <div className="space-y-1.5 text-[11px] text-foreground/50">
              <p>
                <span className="text-foreground/80 font-semibold">Solana mainnet only.</span>{" "}
                Send USDT, USDC, or SOL to this address. Other networks (BSC, ETH, Tron) will lose funds.
              </p>
              <a
                href={`https://solscan.io/account/${walletAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-foreground/60 hover:text-foreground transition-colors"
              >
                View on Solscan <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
