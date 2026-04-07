"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  AlertTriangle,
  Loader2,
} from "lucide-react";

interface DisputeModalProps {
  showDisputeModal: boolean;
  disputeReason: string;
  setDisputeReason: (reason: string) => void;
  disputeDescription: string;
  setDisputeDescription: (desc: string) => void;
  isSubmittingDispute: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

export function DisputeModal({
  showDisputeModal,
  disputeReason,
  setDisputeReason,
  disputeDescription,
  setDisputeDescription,
  isSubmittingDispute,
  onClose,
  onSubmit,
}: DisputeModalProps) {
  return (
    <AnimatePresence>
      {showDisputeModal && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
            onClick={() => onClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed z-50 w-full max-w-md inset-x-0 bottom-0 md:inset-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2"
          >
            <div className="bg-card-solid rounded-t-2xl md:rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden pb-safe md:pb-0">
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Report Issue</h2>
                    <p className="text-[11px] text-gray-500">Raise a dispute for this trade</p>
                  </div>
                </div>
                <button
                  onClick={() => onClose()}
                  className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                <p className="text-[13px] text-gray-400">
                  If you&apos;re having a problem with this trade, our support team will help resolve it.
                </p>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Reason</label>
                  <select
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm text-white outline-none appearance-none border border-white/[0.04]"
                  >
                    <option value="">Select a reason...</option>
                    <option value="payment_not_received">Payment not received</option>
                    <option value="crypto_not_received">Crypto not received</option>
                    <option value="wrong_amount">Wrong amount sent</option>
                    <option value="fraud">Suspected fraud</option>
                    <option value="other">Other issue</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Description</label>
                  <textarea
                    value={disputeDescription}
                    onChange={(e) => setDisputeDescription(e.target.value)}
                    placeholder="Describe the issue in detail..."
                    rows={3}
                    className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm text-white outline-none placeholder:text-gray-600 border border-white/[0.04] resize-none"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 flex gap-3">
                <button
                  onClick={() => onClose()}
                  className="flex-1 py-3 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={onSubmit}
                  disabled={!disputeReason || isSubmittingDispute}
                  className="flex-[2] py-3 rounded-xl text-xs font-bold bg-red-500 text-white hover:bg-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSubmittingDispute ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                  {isSubmittingDispute ? "Submitting..." : "Submit Dispute"}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
