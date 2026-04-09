"use client";

import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import type { Screen, TradeType } from "./types";

const CARD = "bg-surface-card border border-border-subtle";
const FIELD_LABEL = "text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase";

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
  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">
      <div className="h-12 shrink-0" />

      {/* Header */}
      <div className="px-5 py-4 flex items-center shrink-0">
        <button onClick={() => setScreen("home")}
          className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1 bg-surface-raised border border-border-subtle">
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <h1 className="flex-1 text-center pr-8 text-[17px] font-bold text-text-primary tracking-[-0.02em]">
          Create Offer
        </h1>
      </div>

      <div className="flex-1 px-5 overflow-y-auto pb-6 scrollbar-hide">
        <p className="text-[14px] text-text-tertiary mb-5 leading-[1.5]">
          Post an offer for others to accept. Great for large amounts or custom rates.
        </p>

        {/* Offer Type */}
        <div className="mb-5">
          <p className={`${FIELD_LABEL} block mb-2.5`}>I want to</p>
          <div className="flex gap-2">
            {(["buy", "sell"] as const).map((type) => {
              const on = tradeType === type;
              const accentClass = type === "buy" ? "text-success border-success" : "text-error border-error";
              return (
                <button key={type} onClick={() => setTradeType(type)}
                  className={`flex-1 py-3 rounded-xl bg-surface-card text-[14px] font-bold ${
                    on ? `border-[1.5px] ${accentClass}` : 'border border-border-subtle text-text-tertiary'
                  }`}>
                  {type === "buy" ? "Buy USDC" : "Sell USDC"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Amount */}
        <div className="mb-4">
          <p className={`${FIELD_LABEL} block mb-2`}>Amount</p>
          <div className={`rounded-[18px] p-4 ${CARD}`}>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                className="w-full pr-[52px] text-[28px] font-extrabold tracking-[-0.03em] text-text-primary bg-transparent border-0 outline-none"
              />
              <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-text-tertiary">
                USDC
              </span>
            </div>
          </div>
        </div>

        {/* Rate */}
        <div className="mb-4">
          <p className={`${FIELD_LABEL} block mb-2`}>Your rate (AED per USDC)</p>
          <div className={`rounded-[18px] p-4 ${CARD}`}>
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="decimal"
                placeholder="3.67"
                className="flex-1 text-[28px] font-extrabold tracking-[-0.03em] text-text-primary bg-transparent border-0 outline-none"
              />
              <span className="text-[14px] font-semibold text-text-tertiary">AED</span>
            </div>
          </div>
          <p className="text-[12px] text-text-tertiary mt-1.5">Market rate: 3.67 AED</p>
        </div>

        {/* Min/Max */}
        <div className="mb-5">
          <p className={`${FIELD_LABEL} block mb-2`}>Order limits (optional)</p>
          <div className="flex gap-3">
            {[{ placeholder: '100', label: 'Min' }, { placeholder: '10,000', label: 'Max' }].map(f => (
              <div key={f.label} className={`flex-1 rounded-[18px] p-3 ${CARD}`}>
                <p className="text-[9px] font-bold tracking-[0.18em] uppercase text-text-tertiary mb-1">{f.label}</p>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={f.placeholder}
                  className="w-full text-[17px] font-bold text-text-primary bg-transparent border-0 outline-none"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 pb-10 shrink-0">
        <motion.button whileTap={{ scale: 0.98 }}
          className="w-full py-4 rounded-2xl text-[15px] font-extrabold bg-accent text-accent-text tracking-[-0.01em]">
          Post Offer
        </motion.button>
        <p className="text-[12px] text-text-tertiary text-center mt-2.5">
          Your offer will be visible to all traders
        </p>
      </div>
    </div>
  );
};
