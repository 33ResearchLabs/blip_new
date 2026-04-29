"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { WalletLedger } from "@/components/merchant/WalletLedger";

interface AnalyticsModalProps {
  show: boolean;
  merchantId: string | null;
  onClose: () => void;
}

// Overview tab removed per design — the dashboard had only placeholder
// data. Modal now renders the Ledger directly so the header stays clean.
export function AnalyticsModal({ show, merchantId, onClose }: AnalyticsModalProps) {
  return (
    <AnimatePresence>
      {show && merchantId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-card-solid rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-white/[0.08] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] sticky top-0 bg-card-solid z-10">
              <h2 className="text-lg font-semibold text-white">Analytics</h2>
              <button
                onClick={onClose}
                className="p-2 hover:bg-card rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-foreground/35" />
              </button>
            </div>
            <div className="p-6">
              <WalletLedger merchantId={merchantId} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
