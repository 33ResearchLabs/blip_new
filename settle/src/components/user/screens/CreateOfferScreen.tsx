"use client";

import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { colors, sectionLabel, mono } from "@/lib/design/theme";
import type { Screen, TradeType } from "./types";

export interface CreateOfferScreenProps {
  setScreen: (s: Screen) => void;
  tradeType: TradeType;
  setTradeType: (t: TradeType) => void;
}

export const CreateOfferScreen = ({
  setScreen,
  tradeType,
  setTradeType,
}: CreateOfferScreenProps) => {
  const card = { background: colors.surface.card, border: `1px solid ${colors.border.subtle}` };
  const fieldLabel = { fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: colors.text.tertiary, textTransform: 'uppercase' as const };

  return (
    <div className="flex flex-col h-dvh overflow-hidden" style={{ background: colors.bg.primary }}>
      <div className="h-12 shrink-0" />

      {/* Header */}
      <div className="px-5 py-4 flex items-center shrink-0">
        <button onClick={() => setScreen("home")}
          className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1"
          style={{ background: colors.bg.secondary, border: `1px solid ${colors.border.subtle}` }}>
          <ChevronLeft className="w-5 h-5" style={{ color: colors.text.secondary }} />
        </button>
        <h1 className="flex-1 text-center pr-8"
          style={{ fontSize: 17, fontWeight: 700, color: colors.text.primary, letterSpacing: '-0.02em' }}>
          Create Offer
        </h1>
      </div>

      <div className="flex-1 px-5 overflow-y-auto pb-6" style={{ scrollbarWidth: 'none' }}>
        <p style={{ fontSize: 14, color: colors.text.tertiary, marginBottom: 20, lineHeight: 1.5 }}>
          Post an offer for others to accept. Great for large amounts or custom rates.
        </p>

        {/* Offer Type */}
        <div className="mb-5">
          <p style={{ ...fieldLabel, marginBottom: 10, display: 'block' }}>I want to</p>
          <div className="flex gap-2">
            {(["buy", "sell"] as const).map((type) => {
              const on = tradeType === type;
              const accent = type === "buy" ? "#059669" : "#dc2626";
              return (
                <button key={type} onClick={() => setTradeType(type)}
                  className="flex-1 py-3 rounded-xl"
                  style={{
                    background: colors.surface.card,
                    border: on ? `1.5px solid ${accent}` : `1px solid ${colors.border.subtle}`,
                    fontSize: 14, fontWeight: 700, color: on ? accent : colors.text.tertiary,
                    boxShadow: on ? `0 2px 10px ${accent}22` : 'none',
                  }}>
                  {type === "buy" ? "Buy USDC" : "Sell USDC"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Amount */}
        <div className="mb-4">
          <p style={{ ...fieldLabel, marginBottom: 8, display: 'block' }}>Amount</p>
          <div className="rounded-[18px] p-4" style={card}>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                style={{
                  width: '100%', paddingRight: 52, fontSize: 28, fontWeight: 800,
                  letterSpacing: '-0.03em', color: colors.text.primary, background: 'transparent',
                  border: 'none', outline: 'none',
                }}
              />
              <span className="absolute right-0 top-1/2 -translate-y-1/2"
                style={{ fontSize: 14, fontWeight: 600, color: colors.text.tertiary }}>
                USDC
              </span>
            </div>
          </div>
        </div>

        {/* Rate */}
        <div className="mb-4">
          <p style={{ ...fieldLabel, marginBottom: 8, display: 'block' }}>Your rate (AED per USDC)</p>
          <div className="rounded-[18px] p-4" style={card}>
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="decimal"
                placeholder="3.67"
                style={{
                  flex: 1, fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em',
                  color: colors.text.primary, background: 'transparent', border: 'none', outline: 'none',
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: colors.text.tertiary }}>AED</span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: colors.text.tertiary, marginTop: 6 }}>Market rate: 3.67 AED</p>
        </div>

        {/* Min/Max */}
        <div className="mb-5">
          <p style={{ ...fieldLabel, marginBottom: 8, display: 'block' }}>Order limits (optional)</p>
          <div className="flex gap-3">
            {[{ placeholder: '100', label: 'Min' }, { placeholder: '10,000', label: 'Max' }].map(f => (
              <div key={f.label} className="flex-1 rounded-[18px] p-3" style={card}>
                <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: colors.text.tertiary, marginBottom: 4 }}>{f.label}</p>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={f.placeholder}
                  style={{ width: '100%', fontSize: 17, fontWeight: 700, color: colors.text.primary, background: 'transparent', border: 'none', outline: 'none' }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 pb-10 shrink-0">
        <motion.button whileTap={{ scale: 0.98 }}
          className="w-full py-4 rounded-2xl"
          style={{ fontSize: 15, fontWeight: 800, background: colors.accent.primary, color: colors.accent.text, letterSpacing: '-0.01em' }}>
          Post Offer
        </motion.button>
        <p style={{ fontSize: 12, color: colors.text.tertiary, textAlign: 'center', marginTop: 10 }}>
          Your offer will be visible to all traders
        </p>
      </div>
    </div>
  );
};
