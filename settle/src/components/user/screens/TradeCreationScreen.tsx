"use client";

import { motion } from "framer-motion";
import {
  ChevronLeft,
  ArrowDownUp,
  ArrowUpRight,
  ArrowDownLeft,
  Building2,
  Banknote,
  Loader2,
} from "lucide-react";
import { HomeAmbientGlow } from "./HomeDecorations";
import type { Screen, TradeType, TradePreference, PaymentMethod } from "./types";

export interface TradeCreationScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  tradeType: TradeType;
  setTradeType: (t: TradeType) => void;
  tradePreference: TradePreference;
  setTradePreference: (p: TradePreference) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  amount: string;
  setAmount: (a: string) => void;
  fiatAmount: string;
  currentFees: { totalFee: number; traderCut: number };
  isLoading: boolean;
  userId: string | null;
  startTrade: () => void;
  solanaWallet: { connected: boolean; usdtBalance: number | null };
}

export const TradeCreationScreen = ({
  screen,
  setScreen,
  tradeType,
  setTradeType,
  tradePreference,
  setTradePreference,
  paymentMethod,
  setPaymentMethod,
  amount,
  setAmount,
  fiatAmount,
  currentFees,
  isLoading,
  userId,
  startTrade,
  solanaWallet,
}: TradeCreationScreenProps) => {
  return (
    <>
      <HomeAmbientGlow />
      <header className="px-5 pt-14 pb-3 flex items-center gap-4 z-10">
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setScreen('home')} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <ChevronLeft size={18} strokeWidth={2.5} />
        </motion.button>
        <div>
          <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.38em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase', marginBottom: 2 }}>P2P Exchange</p>
          <p style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.03em' }}>Trade USDT</p>
        </div>
      </header>

      <div className="flex-1 px-5 pb-28 overflow-y-auto z-10">
        {/* Buy / Sell toggle */}
        <div className="flex gap-2.5 mb-6">
          {([
            { type: 'buy' as const, label: 'Buy USDT', sub: 'Pay AED', Icon: ArrowDownLeft },
            { type: 'sell' as const, label: 'Sell USDT', sub: 'Get AED', Icon: ArrowUpRight },
          ] as const).map(({ type, label, sub, Icon }) => (
            <motion.button key={type} whileTap={{ scale: 0.96 }} onClick={() => setTradeType(type)}
              className="flex-1 flex flex-col items-start gap-1.5 rounded-[24px] p-4"
              style={tradeType === type
                ? { background: '#ffffff', boxShadow: '0 8px 32px rgba(255,255,255,0.1)' }
                : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="w-9 h-9 rounded-[14px] flex items-center justify-center mb-1"
                style={tradeType === type ? { background: 'rgba(0,0,0,0.08)' } : { background: 'rgba(255,255,255,0.06)' }}>
                <Icon className="w-5 h-5" style={{ color: tradeType === type ? '#000' : 'rgba(255,255,255,0.4)' }} strokeWidth={2.5} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.02em', color: tradeType === type ? '#000' : '#fff' }}>{label}</p>
              <p style={{ fontSize: 10, fontWeight: 700, color: tradeType === type ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{sub}</p>
            </motion.button>
          ))}
        </div>

        {/* Amount */}
        <div className="text-center mb-5">
          <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.38em', color: 'rgba(255,255,255,0.18)', textTransform: 'uppercase', marginBottom: 12 }}>
            {tradeType === 'buy' ? 'You Pay' : 'You Sell'}
          </p>
          <div className="flex items-center justify-center gap-2 mb-2">
            <span style={{ fontSize: 44, fontWeight: 900, letterSpacing: '-0.04em', color: 'rgba(255,255,255,0.2)', lineHeight: 1 }}>{'\u20AE'}</span>
            <input
              type="text" inputMode="decimal" value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0"
              style={{ fontSize: 64, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', width: amount ? `${Math.max(60, amount.length * 38)}px` : '60px', textAlign: 'center', minWidth: 60, maxWidth: 220 }}
            />
            <span style={{ fontSize: 18, fontWeight: 900, color: 'rgba(255,255,255,0.3)' }}>USDT</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', color: 'rgba(255,255,255,0.35)' }}>
              {'\u062F.\u0625'} {amount && parseFloat(amount) > 0 ? parseFloat(fiatAmount).toLocaleString() : '0'}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.2)' }}>AED</span>
          </div>
          {solanaWallet.connected && (
            <p style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.18)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Balance: {solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '\u2014'} USDT
            </p>
          )}
        </div>

        {/* Separator */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
          <motion.button whileTap={{ scale: 0.9 }} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <ArrowDownUp className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.4)' }} />
          </motion.button>
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
        </div>

        {amount && parseFloat(amount) > 0 && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center justify-center gap-3 mb-5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)' }}>Fee</span>
              <span style={{ fontSize: 11, fontWeight: 900, color: '#f97316' }}>{(currentFees.totalFee * 100).toFixed(1)}%</span>
              <div style={{ width: 1, height: 10, background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)' }}>Trader gets</span>
              <span style={{ fontSize: 11, fontWeight: 900, color: 'rgba(255,255,255,0.55)' }}>{(currentFees.traderCut * 100).toFixed(2)}%</span>
            </div>
          </motion.div>
        )}

        {/* Payment Method */}
        <div className="mb-4">
          <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginBottom: 10 }}>Pay Via</p>
          <div className="flex gap-2.5">
            {([
              { method: 'bank' as const, label: 'Bank Transfer', sub: 'Wire / IBAN', Icon: Building2 },
              { method: 'cash' as const, label: 'Cash', sub: 'Meet in person', Icon: Banknote },
            ] as const).map(({ method, label, sub, Icon }) => (
              <motion.button key={method} whileTap={{ scale: 0.96 }} onClick={() => setPaymentMethod(method)}
                className="flex-1 flex items-center gap-3 rounded-[20px] p-3.5"
                style={paymentMethod === method ? { background: '#ffffff' } : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="w-8 h-8 rounded-[12px] flex items-center justify-center shrink-0"
                  style={paymentMethod === method ? { background: 'rgba(0,0,0,0.08)' } : { background: 'rgba(255,255,255,0.06)' }}>
                  <Icon className="w-4 h-4" style={{ color: paymentMethod === method ? '#000' : 'rgba(255,255,255,0.35)' }} />
                </div>
                <div className="text-left">
                  <p style={{ fontSize: 13, fontWeight: 900, color: paymentMethod === method ? '#000' : '#fff', letterSpacing: '-0.01em' }}>{label}</p>
                  <p style={{ fontSize: 9, fontWeight: 700, color: paymentMethod === method ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.22)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{sub}</p>
                </div>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Speed */}
        <div className="mb-6">
          <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginBottom: 10 }}>Priority</p>
          <div className="flex gap-2">
            {([
              { key: 'fast' as const, label: 'Fastest', emoji: '\u26A1', fee: '3%' },
              { key: 'best' as const, label: 'Best Rate', emoji: '\u2605', fee: '2.5%' },
              { key: 'cheap' as const, label: 'Cheapest', emoji: '\u25CE', fee: '1.5%' },
            ] as const).map(({ key, label, emoji, fee }) => (
              <motion.button key={key} whileTap={{ scale: 0.94 }} onClick={() => setTradePreference(key)}
                className="flex-1 flex flex-col items-center gap-1 rounded-[18px] py-3"
                style={tradePreference === key
                  ? { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }
                  : { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontSize: 16 }}>{emoji}</span>
                <span style={{ fontSize: 10, fontWeight: 900, color: tradePreference === key ? '#fff' : 'rgba(255,255,255,0.3)', letterSpacing: '-0.01em' }}>{label}</span>
                <span style={{ fontSize: 8, fontWeight: 900, color: tradePreference === key ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{fee}</span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* CTA */}
        <motion.button whileTap={{ scale: 0.97 }} onClick={startTrade}
          disabled={!amount || parseFloat(amount) <= 0 || isLoading || !userId}
          className="w-full flex items-center justify-center gap-3"
          style={{
            height: 76, borderRadius: 28, fontSize: 18, fontWeight: 900,
            ...(amount && parseFloat(amount) > 0 && !isLoading
              ? { background: '#ffffff', color: '#000', boxShadow: '0 16px 48px rgba(255,255,255,0.09)' }
              : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.07)' })
          }}>
          {isLoading
            ? <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'inherit' }} />
            : amount && parseFloat(amount) > 0
              ? <>{tradeType === 'buy' ? 'Receive' : 'Send'} {amount} USDT <ArrowUpRight className="w-5 h-5" /></>
              : 'Enter Amount'
          }
        </motion.button>

        <button onClick={() => setScreen("create-offer")} className="w-full mt-4 py-3 text-center"
          style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.22)' }}>
          Large amount? <span style={{ color: '#f97316' }}>Create an offer {'\u2192'}</span>
        </button>
      </div>
    </>
  );
};
