"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check, X } from "lucide-react";

interface AcceptedOrderInfo {
  merchantName: string;
  cryptoAmount: number;
  fiatAmount: number;
  orderType: 'buy' | 'sell';
}

interface AcceptancePopupProps {
  showAcceptancePopup: boolean;
  acceptedOrderInfo: AcceptedOrderInfo | null;
  setShowAcceptancePopup: (s: boolean) => void;
}

export function AcceptancePopup({
  showAcceptancePopup, acceptedOrderInfo, setShowAcceptancePopup,
}: AcceptancePopupProps) {
  return (
      <AnimatePresence>
        {showAcceptancePopup && acceptedOrderInfo && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm"
          >
            <div className="bg-[#1a1a1a] rounded-2xl p-4 border border-white/6 shadow-xl shadow-emerald-500/10">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Check className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white mb-1">Order Accepted!</p>
                  <p className="text-xs text-gray-400 mb-2">
                    <span className="text-white font-medium">{acceptedOrderInfo.merchantName}</span> accepted your {acceptedOrderInfo.orderType === 'sell' ? 'sell' : 'buy'} order
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-300 font-medium">{acceptedOrderInfo.cryptoAmount} USDC</span>
                    <span className="text-gray-500">•</span>
                    <span className="text-gray-400">{acceptedOrderInfo.fiatAmount.toLocaleString()} AED</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowAcceptancePopup(false)}
                  className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
  );
}
