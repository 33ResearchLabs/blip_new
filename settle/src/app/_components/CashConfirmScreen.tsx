"use client";

import { motion } from "framer-motion";
import {
  ChevronLeft, Star, MapPin, Navigation, ExternalLink, Shield, Loader2,
} from "lucide-react";
import AmbientGlow from "@/components/user/shared/AmbientGlow";
import type { TradeType, Offer } from "@/types/user";

interface CashConfirmScreenProps {
  maxW: string;
  setScreen: (s: any) => void;
  selectedOffer: Offer;
  setSelectedOffer: (o: Offer | null) => void;
  tradeType: TradeType;
  amount: string;
  fiatAmount: number;
  confirmCashOrder: () => void;
  isLoading: boolean;
}

export function CashConfirmScreen({
  maxW, setScreen, selectedOffer, setSelectedOffer,
  tradeType, amount, fiatAmount, confirmCashOrder, isLoading,
}: CashConfirmScreenProps) {
  return (
          <motion.div
            key="cash-confirm"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col`}
            style={{ background: '#06060e' }}
          >
            <AmbientGlow />
            <div className="h-12" />

            <div className="px-5 py-4 flex items-center z-10">
              <motion.button whileTap={{ scale: 0.9 }} onClick={() => { setScreen("home"); setSelectedOffer(null); }}
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <ChevronLeft size={18} style={{ color: 'rgba(255,255,255,0.5)' }} />
              </motion.button>
              <p className="flex-1 text-center pr-9" style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' }}>Confirm Meeting</p>
            </div>

            <div className="flex-1 px-5 overflow-auto">
              {/* Order Summary */}
              <div className="bg-neutral-900 rounded-2xl p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] text-neutral-500">You {tradeType === "buy" ? "pay" : "receive"}</span>
                  <span className="text-[22px] font-semibold text-white">د.إ {fiatAmount.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-neutral-500">You {tradeType === "buy" ? "receive" : "sell"}</span>
                  <span className="text-[17px] font-medium text-neutral-400">{amount} USDC</span>
                </div>
              </div>

              {/* Merchant Card */}
              <div className="bg-neutral-900 rounded-2xl p-4 mb-4">
                <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-3">Meeting with</p>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white text-lg font-semibold">
                    {selectedOffer.merchant.display_name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <p className="text-[17px] font-medium text-white">{selectedOffer.merchant.display_name}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 fill-amber-400 text-white/70" />
                        <span className="text-[13px] text-neutral-400">{selectedOffer.merchant.rating}</span>
                      </div>
                      <span className="text-neutral-600">·</span>
                      <span className="text-[13px] text-neutral-400">{selectedOffer.merchant.total_trades} trades</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Location Preview */}
              <div className="bg-neutral-900 rounded-2xl overflow-hidden mb-4">
                <div className="relative h-36">
                  <div className="absolute inset-0 bg-black/30" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center">
                      <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center shadow-lg shadow-white/10 mb-1">
                        <MapPin className="w-6 h-6 text-white" />
                      </div>
                      <div className="w-1 h-4 bg-white/10 rounded-b-full" />
                    </div>
                  </div>
                  {/* Grid pattern */}
                  <div className="absolute inset-0 opacity-10">
                    <div className="w-full h-full" style={{
                      backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                      backgroundSize: '30px 30px'
                    }} />
                  </div>
                  {selectedOffer.location_lat && selectedOffer.location_lng && (
                    <button
                      onClick={() => window.open(`https://maps.google.com/?q=${selectedOffer.location_lat},${selectedOffer.location_lng}`, '_blank')}
                      className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-white" />
                      <span className="text-[12px] font-medium text-white">Open Maps</span>
                    </button>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <p className="text-[15px] font-medium text-white">{selectedOffer.location_name}</p>
                    <p className="text-[13px] text-neutral-400">{selectedOffer.location_address}</p>
                  </div>
                  {selectedOffer.meeting_instructions && (
                    <div className="pt-3 border-t border-neutral-800">
                      <p className="text-[11px] text-neutral-500 uppercase tracking-wide mb-1">Meeting spot</p>
                      <div className="flex items-start gap-2">
                        <Navigation className="w-4 h-4 text-white flex-shrink-0 mt-0.5" />
                        <p className="text-[13px] text-white">{selectedOffer.meeting_instructions}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Safety Notice */}
              <div className="bg-white/5 border border-white/6 rounded-2xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-white/70 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[13px] font-medium text-white/70 mb-1">Safety tips</p>
                    <ul className="text-[12px] text-neutral-400 space-y-1">
                      <li>• Meet in public places only</li>
                      <li>• Verify the amount before handing over cash</li>
                      <li>• Keep chat records of your conversation</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="px-5 pb-10 space-y-3">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={confirmCashOrder}
                disabled={isLoading}
                className="w-full py-4 rounded-2xl text-[17px] font-semibold bg-white/10 text-white flex items-center justify-center gap-2"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirm & Start Trade"}
              </motion.button>
              <button
                onClick={() => { setScreen("home"); setSelectedOffer(null); }}
                className="w-full py-3 text-[15px] font-medium text-neutral-500"
              >
                Cancel
              </button>
            </div>
          </motion.div>
  );
}
