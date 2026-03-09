"use client";

import { motion } from "framer-motion";
import {
  ChevronLeft, ArrowDownUp, Building2, Banknote, Loader2,
} from "lucide-react";
import AmbientGlow from "@/components/user/shared/AmbientGlow";
import type { TradeType, TradePreference, PaymentMethod } from "@/types/user";

interface SendTradeScreenProps {
  maxW: string;
  setScreen: (s: any) => void;
  tradeType: TradeType;
  setTradeType: (t: TradeType) => void;
  amount: string;
  setAmount: (a: string) => void;
  fiatAmount: number;
  currentRate: number;
  currentFees: { totalFee: number; traderCut: number };
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  tradePreference: TradePreference;
  setTradePreference: (p: TradePreference) => void;
  solanaWallet: any;
  setShowWalletModal: (s: boolean) => void;
  startTrade: () => void;
  isLoading: boolean;
  userId: string | null;
}

export function SendTradeScreen({
  maxW, setScreen, tradeType, setTradeType, amount, setAmount,
  fiatAmount, currentRate, currentFees, paymentMethod, setPaymentMethod,
  tradePreference, setTradePreference, solanaWallet, setShowWalletModal,
  startTrade, isLoading, userId,
}: SendTradeScreenProps) {
  return (
          <motion.div key="send" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className={`flex-1 w-full ${maxW} flex flex-col relative`}
            style={{ background: '#06060e' }}>
            <AmbientGlow />

            {/* Header */}
            <div className="px-5 pt-14 pb-4 flex items-center justify-between z-10">
              <motion.button whileTap={{ scale: 0.9 }} onClick={() => setScreen("home")}
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <ChevronLeft size={18} style={{ color: 'rgba(255,255,255,0.5)' }} />
              </motion.button>
              <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' }}>Trade</p>
              <div style={{ width: 36 }} />
            </div>

            <div className="flex-1 overflow-y-auto pb-28 no-scrollbar z-10 px-5">
              {/* Buy/Sell Toggle */}
              <div className="flex items-center gap-1 rounded-2xl p-1 mb-5"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                {(["buy", "sell"] as const).map(type => (
                  <button key={type} onClick={() => setTradeType(type)}
                    className="flex-1 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-wider transition-all"
                    style={tradeType === type
                      ? { background: 'rgba(255,255,255,0.06)', color: '#fff' }
                      : { color: 'rgba(255,255,255,0.25)' }
                    }>
                    {type === "buy" ? "Buy" : "Sell"}
                  </button>
                ))}
              </div>

              {/* Amount Input */}
              <div className="rounded-[28px] p-5 mb-4"
                style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}>
                <div className="flex items-center justify-between mb-3">
                  <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase' }}>
                    {tradeType === "buy" ? "You pay" : "You sell"}
                  </span>
                  {solanaWallet.connected ? (
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                      Bal: <span style={{ color: '#10b981' }}>{solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '...'}</span>
                    </span>
                  ) : (
                    <button onClick={() => setShowWalletModal(true)} style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                      Connect Wallet
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <input type="text" inputMode="decimal" value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0"
                    className="flex-1 bg-transparent outline-none"
                    style={{ fontSize: 42, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff' }}
                  />
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div className="w-6 h-6 rounded-full bg-[#26A17B] flex items-center justify-center">
                      <span className="text-white text-[10px] font-bold">₮</span>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 900, color: 'rgba(255,255,255,0.6)' }}>USDT</span>
                  </div>
                </div>
              </div>

              {/* Swap Icon */}
              <div className="flex justify-center -my-2 relative z-10">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '4px solid #06060e' }}>
                  <ArrowDownUp className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.3)' }} />
                </div>
              </div>

              {/* Output */}
              <div className="rounded-[28px] p-5 mb-4"
                style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}>
                <div className="flex items-center justify-between mb-3">
                  <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase' }}>
                    {tradeType === "buy" ? "You receive" : "You get"}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.18)' }}>1 USDC = {currentRate} AED</span>
                </div>
                <div className="flex items-center gap-3">
                  <p style={{ flex: 1, fontSize: 42, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff' }}>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>د.إ</span> {amount ? fiatAmount.toLocaleString() : "0"}
                  </p>
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <span style={{ fontSize: 14 }}>🇦🇪</span>
                    <span style={{ fontSize: 14, fontWeight: 900, color: 'rgba(255,255,255,0.6)' }}>AED</span>
                  </div>
                </div>
              </div>

              {/* Fee */}
              {amount && parseFloat(amount) > 0 && (
                <div className="flex items-center justify-center gap-3 mb-4" style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
                  <span>Fee: {(currentFees.totalFee * 100).toFixed(1)}%</span>
                  <span>·</span>
                  <span>Trader gets {(currentFees.traderCut * 100).toFixed(2)}%</span>
                </div>
              )}

              {/* Payment Method */}
              <div className="mb-4 flex items-center justify-between">
                <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase' }}>Pay via</p>
                <div className="flex items-center gap-1 rounded-xl p-1"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  {([
                    { key: "bank" as const, icon: Building2, label: "Bank" },
                    { key: "cash" as const, icon: Banknote, label: "Cash" },
                  ]).map(({ key, icon: Icon, label }) => (
                    <button key={key} onClick={() => setPaymentMethod(key)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all"
                      style={paymentMethod === key
                        ? { background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 11, fontWeight: 900 }
                        : { color: 'rgba(255,255,255,0.25)', fontSize: 11, fontWeight: 900 }
                      }>
                      <Icon size={13} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Speed Options */}
              <div className="mb-5">
                <p className="mb-3" style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase' }}>
                  Matching priority
                </p>
                <div className="flex gap-2">
                  {([
                    { key: "fast" as const, label: "Fastest" },
                    { key: "best" as const, label: "Best rate" },
                    { key: "cheap" as const, label: "Cheapest" },
                  ]).map(({ key, label }) => (
                    <button key={key} onClick={() => setTradePreference(key)}
                      className="flex-1 py-2.5 rounded-2xl text-[12px] font-black tracking-wide transition-all"
                      style={tradePreference === key
                        ? { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }
                        : { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.2)' }
                      }>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* CTA */}
              <motion.button whileTap={{ scale: 0.96 }} onClick={startTrade}
                disabled={!amount || parseFloat(amount) <= 0 || isLoading || !userId}
                className="w-full py-5 rounded-[28px] text-[18px] font-black tracking-tight transition-all flex items-center justify-center gap-2"
                style={amount && parseFloat(amount) > 0 && !isLoading
                  ? { background: '#fff', color: '#000', boxShadow: '0 0 40px rgba(255,255,255,0.08)' }
                  : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.15)' }
                }>
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue"}
              </motion.button>

              {/* Create Offer */}
              <button onClick={() => setScreen("create-offer")}
                className="w-full mt-3 py-3 text-center"
                style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.2)' }}>
                Large amount? <span style={{ color: 'rgba(255,255,255,0.4)' }}>Create an offer</span>
              </button>
            </div>
          </motion.div>
  );
}
