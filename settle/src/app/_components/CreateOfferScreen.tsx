"use client";

import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import AmbientGlow from "@/components/user/shared/AmbientGlow";
import type { TradeType } from "@/types/user";

interface CreateOfferScreenProps {
  maxW: string;
  setScreen: (s: any) => void;
  tradeType: TradeType;
  setTradeType: (t: TradeType) => void;
}

export function CreateOfferScreen({
  maxW, setScreen, tradeType, setTradeType,
}: CreateOfferScreenProps) {
  return (
          <motion.div
            key="create-offer"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
            style={{ background: '#06060e' }}
          >
            <AmbientGlow />
            <div className="h-12" />

            <div className="px-5 py-4 flex items-center z-10">
              <motion.button whileTap={{ scale: 0.9 }} onClick={() => setScreen("home")}
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <ChevronLeft size={18} style={{ color: 'rgba(255,255,255,0.5)' }} />
              </motion.button>
              <p className="flex-1 text-center pr-9" style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' }}>Create Offer</p>
            </div>

            <div className="flex-1 px-5">
              <p className="text-[15px] text-neutral-500 mb-6">
                Post an offer for others to accept. Great for large amounts or custom rates.
              </p>

              {/* Offer Type */}
              <div className="mb-5">
                <p className="text-[13px] text-neutral-500 mb-3">I want to</p>
                <div className="flex gap-2">
                  {(["buy", "sell"] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setTradeType(type)}
                      className={`flex-1 py-3 rounded-xl text-[15px] font-medium transition-all ${
                        tradeType === type
                          ? "bg-white/10 text-white"
                          : "bg-neutral-900 text-neutral-400"
                      }`}
                    >
                      {type === "buy" ? "Buy USDC" : "Sell USDC"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div className="mb-5">
                <p className="text-[13px] text-neutral-500 mb-2">Amount</p>
                <div className="bg-neutral-900 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      className="flex-1 text-[24px] font-semibold text-white bg-transparent outline-none placeholder:text-neutral-700"
                    />
                    <span className="text-[15px] font-medium text-neutral-400">USDC</span>
                  </div>
                </div>
              </div>

              {/* Rate */}
              <div className="mb-5">
                <p className="text-[13px] text-neutral-500 mb-2">Your rate (AED per USDC)</p>
                <div className="bg-neutral-900 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="3.67"
                      className="flex-1 text-[24px] font-semibold text-white bg-transparent outline-none placeholder:text-neutral-700"
                    />
                    <span className="text-[15px] font-medium text-neutral-400">AED</span>
                  </div>
                </div>
                <p className="text-[13px] text-neutral-600 mt-2">Market rate: 3.67 AED</p>
              </div>

              {/* Min/Max */}
              <div className="mb-5">
                <p className="text-[13px] text-neutral-500 mb-2">Order limits (optional)</p>
                <div className="flex gap-3">
                  <div className="flex-1 bg-neutral-900 rounded-xl p-3">
                    <p className="text-[11px] text-neutral-600 mb-1">Min</p>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="100"
                      className="w-full text-[17px] font-medium text-white bg-transparent outline-none placeholder:text-neutral-700"
                    />
                  </div>
                  <div className="flex-1 bg-neutral-900 rounded-xl p-3">
                    <p className="text-[11px] text-neutral-600 mb-1">Max</p>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="10,000"
                      className="w-full text-[17px] font-medium text-white bg-transparent outline-none placeholder:text-neutral-700"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 pb-10">
              <motion.button
                whileTap={{ scale: 0.98 }}
                className="w-full py-4 rounded-2xl text-[17px] font-semibold bg-white/10 text-white"
              >
                Post Offer
              </motion.button>
              <p className="text-[13px] text-neutral-600 text-center mt-3">
                Your offer will be visible to all traders
              </p>
            </div>
          </motion.div>
  );
}
