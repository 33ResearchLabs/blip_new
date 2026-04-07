"use client";

import { motion } from "framer-motion";
import { colors, sectionLabel, mono } from "@/lib/design/theme";
import {
  ChevronLeft,
  Star,
  MapPin,
  ExternalLink,
  Navigation,
  Shield,
  Loader2,
} from "lucide-react";
import type { Screen, TradeType, Offer } from "./types";

export interface CashConfirmScreenProps {
  setScreen: (s: Screen) => void;
  selectedOffer: Offer;
  setSelectedOffer: (o: Offer | null) => void;
  tradeType: TradeType;
  amount: string;
  fiatAmount: string;
  isLoading: boolean;
  confirmCashOrder: () => void;
}

export const CashConfirmScreen = ({
  setScreen,
  selectedOffer,
  setSelectedOffer,
  tradeType,
  amount,
  fiatAmount,
  isLoading,
  confirmCashOrder,
}: CashConfirmScreenProps) => {
  return (
    <>
      <div className="h-12" />

      <div className="px-5 py-4 flex items-center">
        <button onClick={() => { setScreen("home"); setSelectedOffer(null); }} className="p-2 -ml-2">
          <ChevronLeft className="w-6 h-6" style={{ color: colors.text.primary }} />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold pr-8" style={{ color: colors.text.primary }}>Confirm Meeting</h1>
      </div>

      <div className="flex-1 px-5 overflow-auto">
        {/* Order Summary */}
        <div className="rounded-2xl p-4 mb-4" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] " style={{ color: colors.text.tertiary }}>You {tradeType === "buy" ? "pay" : "receive"}</span>
            <span className="text-[22px] font-semibold" style={{ color: colors.text.primary }}>{'\u062F.\u0625'} {parseFloat(fiatAmount).toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] " style={{ color: colors.text.tertiary }}>You {tradeType === "buy" ? "receive" : "sell"}</span>
            <span className="text-[17px] font-medium" style={{ color: colors.text.secondary }}>{amount} USDC</span>
          </div>
        </div>

        {/* Merchant Card */}
        <div className="rounded-2xl p-4 mb-4" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
          <p className="text-[11px] uppercase tracking-wide mb-3" style={{ color: colors.text.tertiary }}>Meeting with</p>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold" style={{ background: colors.border.medium, border: `1px solid ${colors.border.medium}`, color: colors.text.primary }}>
              {selectedOffer.merchant.display_name.charAt(0)}
            </div>
            <div className="flex-1">
              <p className="text-[17px] font-medium" style={{ color: colors.text.primary }}>{selectedOffer.merchant.display_name}</p>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Star className="w-3 h-3 fill-amber-400" style={{ color: colors.text.secondary }} />
                  <span className="text-[13px]" style={{ color: colors.text.secondary }}>{selectedOffer.merchant.rating}</span>
                </div>
                <span style={{ color: colors.text.tertiary }}>{'\u00b7'}</span>
                <span className="text-[13px]" style={{ color: colors.text.secondary }}>{selectedOffer.merchant.total_trades} trades</span>
              </div>
            </div>
          </div>
        </div>

        {/* Location Preview */}
        <div className="rounded-2xl overflow-hidden mb-4" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
          <div className="relative h-36">
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg mb-1" style={{ background: colors.border.medium, boxShadow: `0 10px 15px ${colors.border.medium}` }}>
                  <MapPin className="w-6 h-6" style={{ color: colors.text.primary }} />
                </div>
                <div className="w-1 h-4 rounded-b-full" style={{ background: colors.border.medium }} />
              </div>
            </div>
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
                <ExternalLink className="w-3.5 h-3.5" style={{ color: colors.text.primary }} />
                <span className="text-[12px] font-medium" style={{ color: colors.text.primary }}>Open Maps</span>
              </button>
            )}
          </div>
          <div className="p-4 space-y-3">
            <div>
              <p className="text-[15px] font-medium" style={{ color: colors.text.primary }}>{selectedOffer.location_name}</p>
              <p className="text-[13px]" style={{ color: colors.text.secondary }}>{selectedOffer.location_address}</p>
            </div>
            {selectedOffer.meeting_instructions && (
              <div className="pt-3" style={{ borderTop: `1px solid ${colors.border.subtle}` }}>
                <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: colors.text.tertiary }}>Meeting spot</p>
                <div className="flex items-start gap-2">
                  <Navigation className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: colors.text.primary }} />
                  <p className="text-[13px]" style={{ color: colors.text.primary }}>{selectedOffer.meeting_instructions}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Safety Notice */}
        <div className="rounded-2xl p-4 mb-4" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: colors.text.secondary }} />
            <div>
              <p className="text-[13px] font-medium mb-1" style={{ color: colors.text.secondary }}>Safety tips</p>
              <ul className="text-[12px] space-y-1" style={{ color: colors.text.secondary }}>
                <li>{'\u2022'} Meet in public places only</li>
                <li>{'\u2022'} Verify the amount before handing over cash</li>
                <li>{'\u2022'} Keep chat records of your conversation</li>
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
          className="w-full py-4 rounded-2xl text-[17px] font-semibold flex items-center justify-center gap-2"
          style={{ background: colors.accent.primary, color: colors.accent.text }}
        >
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirm & Start Trade"}
        </motion.button>
        <button
          onClick={() => { setScreen("home"); setSelectedOffer(null); }}
          className="w-full py-3 text-[15px] font-medium"
          style={{ color: colors.text.tertiary }}
        >
          Cancel
        </button>
      </div>
    </>
  );
};
