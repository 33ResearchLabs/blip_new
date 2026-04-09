"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Wallet } from "lucide-react";

interface WalletPromptModalProps {
  show: boolean;
  onDismiss: () => void;
  onConnect: () => void;
}

export function WalletPromptModal({
  show,
  onDismiss,
  onConnect,
}: WalletPromptModalProps) {
  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 z-50"
            onClick={onDismiss}
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
              <p className="text-foreground/40 text-sm mb-6">
                Connect your Solana wallet to receive payments from escrow releases. This wallet will be saved to your account.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onDismiss}
                  className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-foreground/40 font-medium text-sm hover:bg-card transition-colors"
                >
                  Later
                </button>
                <button
                  onClick={onConnect}
                  className="flex-1 px-4 py-3 rounded-xl bg-white/20 text-white font-medium text-sm hover:bg-accent-subtle transition-colors flex items-center justify-center gap-2"
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
