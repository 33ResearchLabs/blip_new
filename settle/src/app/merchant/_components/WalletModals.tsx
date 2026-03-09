"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Wallet, X } from "lucide-react";

// ─── Wallet Required Modal ──────────────────────────────────────────────────
// Shown when an action requires a connected wallet.
// Redirects to /merchant/wallet via the onGoToWallet callback.

interface WalletRequiredModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGoToWallet: () => void;
}

export function WalletRequiredModal({ isOpen, onClose, onGoToWallet }: WalletRequiredModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="glass-card rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-orange-500/10">
                    <Wallet className="w-5 h-5 text-orange-400" />
                  </div>
                  <h2 className="text-base font-bold text-white">Connect Wallet</h2>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors -mt-1 -mr-1"
                >
                  <X className="w-4 h-4 text-white/40" />
                </button>
              </div>
            </div>
            <div className="px-5 pb-5">
              <p className="text-[13px] text-white/60 leading-relaxed">
                A connected wallet is required for this action. Go to the Wallet tab to connect or set up your wallet.
              </p>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={onClose}
                className="flex-1 px-3 py-2.5 rounded-xl border border-white/[0.06] text-[12px] text-white/50 hover:bg-white/[0.04] transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onClose();
                  onGoToWallet();
                }}
                className="flex-1 px-3 py-2.5 rounded-xl text-[12px] font-bold transition-all bg-gradient-to-b from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-black shadow-[0_2px_12px_rgba(249,115,22,0.15)]"
              >
                Go to Wallet
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Wallet Prompt Modal ────────────────────────────────────────────────────
// Shown after login if no wallet is connected.
// The parent computes: showWalletPrompt && !isMockMode && !IS_EMBEDDED_WALLET && !solanaWallet.connected
// and passes the result as `isOpen`.

interface WalletPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectWallet: () => void;
}

export function WalletPromptModal({ isOpen, onClose, onConnectWallet }: WalletPromptModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md bg-white/[0.03] rounded-2xl p-6 border border-white/10"
          >
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/[0.04] flex items-center justify-center">
                <Wallet className="w-8 h-8 text-white/70" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Connect Your Wallet</h3>
              <p className="text-gray-400 text-sm mb-6">
                Connect your Solana wallet to receive payments from escrow releases. This wallet will be saved to your account.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-gray-400 font-medium text-sm hover:bg-white/5 transition-colors"
                >
                  Later
                </button>
                <button
                  onClick={() => {
                    onClose();
                    onConnectWallet();
                  }}
                  className="flex-1 px-4 py-3 rounded-xl bg-white/20 text-white font-medium text-sm hover:bg-white/[0.15] transition-colors flex items-center justify-center gap-2"
                >
                  <Wallet className="w-4 h-4" />
                  Connect Wallet
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
