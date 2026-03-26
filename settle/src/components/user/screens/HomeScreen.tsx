"use client";

import { motion } from "framer-motion";
import {
  Bell,
  ChevronRight,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  TrendingUp,
  Zap,
  QrCode,
  Activity,
  User,
  Home,
} from "lucide-react";
import { ConnectionIndicator } from "@/components/NotificationToast";
import { HomeSparkline, HomeAmbientGlow } from "./HomeDecorations";
import type { Screen, Order } from "./types";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';
const IS_MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

export interface HomeScreenProps {
  userName: string;
  userId: string | null;
  orders: Order[];
  completedOrders: Order[];
  pendingOrders: Order[];
  currentRate: number;
  screen: Screen;
  setScreen: (s: Screen) => void;
  setTradeType: (t: "buy" | "sell") => void;
  setActiveOrderId: (id: string) => void;
  setPendingTradeData: (data: { amount: string; fiatAmount: string; type: "buy" | "sell"; paymentMethod: "bank" | "cash" } | null) => void;
  setShowWalletModal: (v: boolean) => void;
  setShowWalletSetup: (v: boolean) => void;
  setShowWalletUnlock: (v: boolean) => void;
  solanaWallet: {
    connected: boolean;
    walletAddress: string | null;
    usdtBalance: number | null;
  };
  embeddedWallet?: {
    state: 'none' | 'locked' | 'unlocked';
  };
  userBalance?: number;
  maxW: string;
}

export const HomeScreen = ({
  userName,
  userId,
  orders,
  completedOrders,
  pendingOrders,
  currentRate,
  screen,
  setScreen,
  setTradeType,
  setActiveOrderId,
  setPendingTradeData,
  setShowWalletModal,
  setShowWalletSetup,
  setShowWalletUnlock,
  solanaWallet,
  embeddedWallet,
  userBalance,
  maxW,
}: HomeScreenProps) => {
  // In mock mode, use DB balance; otherwise use on-chain balance
  const displayBalance = IS_MOCK_MODE ? (userBalance ?? 0) : solanaWallet.usdtBalance;
  // In mock mode, consider "connected" if user is logged in (userId exists)
  const isWalletReady = IS_MOCK_MODE ? (userBalance !== undefined && userBalance !== null) : solanaWallet.connected;
  return (
    <>
      <HomeAmbientGlow />
      {/* Top Bar */}
      <header className="px-5 pt-14 pb-3 flex items-center justify-between z-10">
        <div>
          <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.38em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase', marginBottom: 3 }}>Portfolio</p>
          <div className="flex items-center gap-1.5">
            <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.04em' }}>{userName}</span>
            <ConnectionIndicator isConnected={!!userId} />
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setScreen("chats")}
            className="w-9 h-9 rounded-xl flex items-center justify-center relative"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <Bell className="w-[15px] h-[15px]" style={{ color: 'rgba(255,255,255,0.4)' }} />
            {orders.reduce((sum, o) => sum + (o.unreadCount || 0), 0) > 0 && (
              <div className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#f97316] border-2 border-[#080810] flex items-center justify-center">
                <span className="text-[8px] font-bold text-white">
                  {orders.reduce((sum, o) => sum + (o.unreadCount || 0), 0)}
                </span>
              </div>
            )}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              if (IS_EMBEDDED_WALLET) {
                if (embeddedWallet?.state === 'locked') setShowWalletUnlock(true);
                else if (embeddedWallet?.state === 'none') setShowWalletSetup(true);
                else setScreen("profile");
              } else {
                setScreen("profile");
              }
            }}
            className="w-9 h-9 rounded-[14px] overflow-hidden"
            style={{ border: '2px solid rgba(124,58,237,0.45)' }}
          >
            <div className="w-full h-full flex items-center justify-center font-black text-sm text-white"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #059669)' }}>
              {userName.charAt(0).toUpperCase()}
            </div>
          </motion.button>
        </div>
      </header>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto pb-28 no-scrollbar z-10" style={{ paddingLeft: 20, paddingRight: 20 }}>

        {/* Wallet Card — always visible */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="relative mb-5">
          <div className="absolute inset-0 rounded-[40px] opacity-70" style={{
            background: 'radial-gradient(ellipse at 25% 35%, rgba(16,185,129,0.22) 0%, transparent 55%), radial-gradient(ellipse at 80% 75%, rgba(124,58,237,0.22) 0%, transparent 55%)',
            filter: 'blur(22px)', transform: 'scale(1.05)',
          }} />
          <div className="relative overflow-hidden rounded-[40px]" style={{
            background: 'linear-gradient(148deg, #0b0e1a 0%, #12102c 42%, #0c1a2e 100%)',
            border: '1px solid rgba(255,255,255,0.085)',
            boxShadow: '0 28px 72px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.055)',
            minHeight: 252,
          }}>
            <div className="absolute" style={{ top: 0, left: 0, width: 180, height: 180, background: 'radial-gradient(circle, rgba(16,185,129,0.16) 0%, transparent 70%)', transform: 'translate(-38%, -38%)' }} />
            <div className="absolute" style={{ bottom: 0, right: 0, width: 180, height: 180, background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)', transform: 'translate(38%, 38%)' }} />
            <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '22px 22px', opacity: 0.4 }} />
            <motion.div animate={{ x: ['-220%', '220%'] }} transition={{ duration: 3.5, repeat: Infinity, repeatDelay: 5.5, ease: 'easeInOut' }} className="absolute inset-0 skew-x-12" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.035), transparent)' }} />
            <div className="relative z-10 p-6">
              <div className="flex justify-between items-start mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-[14px] flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #059669, #7c3aed)', boxShadow: '0 0 18px rgba(16,185,129,0.35)' }}>
                    <Zap size={15} className="fill-white text-white" />
                  </div>
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>BLIP</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
                      <span style={{ fontSize: 8, fontWeight: 900, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Live</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.18)', textTransform: 'uppercase' }}>Signature</p>
                  <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.18)', textTransform: 'uppercase' }}>v 2.0</p>
                </div>
              </div>

              {isWalletReady ? (
                <>
                  <div className="mb-1">
                    <p style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginBottom: 4 }}>Total Balance</p>
                    <div className="flex items-baseline gap-0">
                      <span style={{ fontSize: 54, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, color: '#fff' }}>
                        {displayBalance !== null ? Math.floor(displayBalance).toLocaleString() : '0'}
                      </span>
                      <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em', color: 'rgba(255,255,255,0.25)', lineHeight: 1 }}>
                        {displayBalance !== null ? '.' + (displayBalance % 1).toFixed(2).slice(2) : '.00'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.13)', border: '1px solid rgba(16,185,129,0.3)' }}>
                      <TrendingUp size={9} style={{ color: '#10b981' }} />
                      <span style={{ fontSize: 10, fontWeight: 900, color: '#10b981' }}>{completedOrders.length > 0 ? `+${completedOrders.length} trades` : 'Ready'}</span>
                    </div>
                    <span style={{ fontSize: 8.5, fontWeight: 700, color: 'rgba(255,255,255,0.18)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{currentRate} AED</span>
                  </div>
                  <div className="mb-4" style={{ marginLeft: -4, marginRight: -4 }}>
                    <HomeSparkline />
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                      <p style={{ fontSize: 7, fontWeight: 900, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.18)', textTransform: 'uppercase', marginBottom: 2 }}>ID Hash</p>
                      <p style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: 'rgba(255,255,255,0.45)' }}>
                        {solanaWallet.walletAddress ? `${solanaWallet.walletAddress.slice(0,4)}...${solanaWallet.walletAddress.slice(-4)}` : '\u2014'}
                      </p>
                    </div>
                    <div className="flex" style={{ gap: 0 }}>
                      {['#1a56db', '#7c3aed'].map((c, i) => (
                        <div key={i} className="w-7 h-7 rounded-full flex items-center justify-center"
                          style={{ background: c, border: '2px solid rgba(0,0,0,0.5)', marginLeft: i > 0 ? -8 : 0, opacity: 0.75 }}>
                          {i === 0 && <div className="w-1.5 h-1.5 rounded-full bg-white opacity-70" />}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-start gap-3 py-2">
                  <div>
                    <p style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginBottom: 4 }}>Total Balance</p>
                    <p style={{ fontSize: 42, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, color: 'rgba(255,255,255,0.15)' }}>\u2014\u2014</p>
                  </div>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', lineHeight: 1.4, marginTop: 8 }}>
                    {IS_EMBEDDED_WALLET
                      ? embeddedWallet?.state === 'locked' ? 'Unlock your wallet to see balance' : 'Set up a wallet to start trading'
                      : 'Connect your Solana wallet to trade'}
                  </p>
                  <button
                    onClick={() => {
                      if (IS_EMBEDDED_WALLET) {
                        if (embeddedWallet?.state === 'locked') setShowWalletUnlock(true);
                        else setShowWalletSetup(true);
                      } else {
                        setShowWalletModal(true);
                      }
                    }}
                    className="px-4 py-2 rounded-[14px] text-[13px] font-black uppercase tracking-wider mt-1"
                    style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}>
                    {IS_EMBEDDED_WALLET
                      ? embeddedWallet?.state === 'locked' ? 'Unlock Wallet' : 'Create Wallet'
                      : 'Connect Wallet'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Active Order Banner */}
        {pendingOrders.length > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setActiveOrderId(pendingOrders[0].id);
              if (pendingOrders[0].status === "pending") {
                setPendingTradeData({
                  amount: pendingOrders[0].cryptoAmount,
                  fiatAmount: pendingOrders[0].fiatAmount,
                  type: pendingOrders[0].type,
                  paymentMethod: pendingOrders[0].merchant.paymentMethod
                });
                setScreen("matching");
              } else {
                setScreen("order");
              }
            }}
            className="w-full flex items-center gap-3 rounded-[22px] mb-5 text-left"
            style={{ padding: '12px 14px', background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'rgba(249,115,22,0.1)' }}>
              <motion.div className="w-2.5 h-2.5 rounded-full bg-[#f97316]"
                animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
            </div>
            <div className="flex-1">
              <p style={{ fontSize: 14, fontWeight: 900, color: '#fff', marginBottom: 2 }}>
                {pendingOrders[0].type === "buy" ? "Buying" : "Selling"} {pendingOrders[0].cryptoAmount} USDT
              </p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {pendingOrders[0].status === "pending" ? "Finding merchant..." : `Step ${pendingOrders[0].step} of 4 \u00b7 Tap to continue`}
              </p>
            </div>
            <ChevronRight className="w-5 h-5" style={{ color: '#f97316' }} />
          </motion.button>
        )}

        {/* Quick Stats Chips */}
        {(() => {
          const totalIn = completedOrders.filter(o => o.type === 'buy').reduce((s, o) => s + parseFloat(o.fiatAmount || '0'), 0);
          const totalOut = completedOrders.filter(o => o.type === 'sell').reduce((s, o) => s + parseFloat(o.fiatAmount || '0'), 0);
          return (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="flex gap-2.5 mb-6">
              {[
                { label: 'Total In',  value: totalIn > 0 ? `+\u062F.\u0625${totalIn.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '+\u062F.\u0625\u0030', color: '#10b981' },
                { label: 'Total Out', value: totalOut > 0 ? `-\u062F.\u0625${totalOut.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-\u062F.\u0625\u0030', color: '#f87171' },
                { label: 'Pending',   value: `${pendingOrders.length} txns`, color: '#fbbf24' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex-1 rounded-[18px] px-3 py-3" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}>
                  <p style={{ fontSize: 7.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'rgba(255,255,255,0.25)', marginBottom: 6 }}>{label}</p>
                  <p style={{ fontSize: 13, fontWeight: 900, color }}>{value}</p>
                </div>
              ))}
            </motion.div>
          );
        })()}

        {/* Action Grid */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13 }} className="grid grid-cols-4 gap-2 mb-8">
          {([
            { label: 'Send',     Icon: ArrowUpRight,   primary: true,  fn: () => { setTradeType('buy');  setScreen('trade'); } },
            { label: 'Receive',  Icon: ArrowDownLeft,  primary: false, fn: () => { setTradeType('sell'); setScreen('trade'); } },
            { label: 'Activity', Icon: Activity,       primary: false, fn: () => setScreen('orders') },
            { label: 'Scan',     Icon: QrCode,         primary: false, fn: () => setScreen('chats') },
          ] as const).map(({ label, Icon, primary, fn }) => (
            <motion.button key={label} whileTap={{ scale: 0.94 }} onClick={fn} className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={
                primary
                  ? { background: '#ffffff', boxShadow: '0 8px 28px rgba(255,255,255,0.12)' }
                  : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }
              }>
                <Icon size={21} strokeWidth={2.5} style={{ color: primary ? '#000' : 'rgba(255,255,255,0.45)' }} />
              </div>
              <span style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: primary ? '#fff' : 'rgba(255,255,255,0.3)' }}>{label}</span>
            </motion.button>
          ))}
        </motion.div>

        {/* Circle — recent trade partners */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase' }}>Circle</p>
          </div>
          {orders.length === 0 ? (
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontWeight: 600 }}>No trading partners yet</p>
          ) : (
            <div className="flex gap-4 overflow-x-auto no-scrollbar" style={{ marginLeft: -4, paddingLeft: 4, paddingRight: 4 }}>
              {(() => {
                const seen = new Set<string>();
                return orders.filter(o => { if (seen.has(o.merchant.id)) return false; seen.add(o.merchant.id); return true; }).slice(0, 4);
              })().map((order, i) => {
                const colors = ['#7c3aed', '#059669', '#1a56db', '#f97316'];
                const isActive = order.status !== 'complete' && order.status !== 'cancelled' && order.status !== 'expired';
                return (
                  <motion.div key={order.merchant.id}
                    initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.18 + i * 0.06 }}
                    whileTap={{ scale: 0.94 }} className="flex flex-col items-center gap-2 shrink-0">
                    <div className="relative">
                      <div style={isActive
                        ? { padding: 2, borderRadius: 24, background: `linear-gradient(135deg, ${colors[i % colors.length]}, #10b981)` }
                        : { padding: 2, borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ width: 56, height: 56, borderRadius: 22, background: `linear-gradient(135deg, ${colors[i % colors.length]}33, ${colors[i % colors.length]}66)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: 22, fontWeight: 900, color: colors[i % colors.length] }}>{order.merchant.name?.charAt(0)?.toUpperCase() ?? '?'}</span>
                        </div>
                      </div>
                      {isActive && (
                        <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 2, repeat: Infinity }}
                          className="absolute flex items-center justify-center"
                          style={{ bottom: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#10b981', border: '2px solid #080810', boxShadow: '0 0 8px rgba(16,185,129,0.7)' }}>
                          <Zap size={7} className="fill-white text-white" />
                        </motion.div>
                      )}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)' }}>{order.merchant.name?.split(' ')?.[0] ?? 'Trader'}</span>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Pulse */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase' }}>Recent Pulse</p>
            <motion.button whileTap={{ scale: 0.94 }} onClick={() => setScreen('orders')}
              style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.1em', color: '#a78bfa', textTransform: 'uppercase' }}>
              See all
            </motion.button>
          </div>
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-14 h-14 rounded-[20px] flex items-center justify-center mb-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <Activity size={22} style={{ color: 'rgba(255,255,255,0.15)' }} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.02em', marginBottom: 4 }}>No trades yet</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontWeight: 600 }}>Start your first P2P trade</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {orders.slice(0, 4).map((order, i) => {
                const isBuy = order.type === 'buy';
                const catColor = isBuy ? '#f97316' : '#10b981';
                const catLabel = isBuy ? 'Receive' : 'Send';
                return (
                  <motion.button key={order.id}
                    initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.22 + i * 0.07 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setActiveOrderId(order.id); setScreen('order'); }}
                    className="w-full flex items-center gap-3 rounded-[22px] text-left"
                    style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="relative shrink-0 rounded-2xl flex items-center justify-center" style={{ width: 48, height: 48, background: `${catColor}18`, border: `1px solid ${catColor}30` }}>
                      {isBuy
                        ? <ArrowDownLeft size={20} style={{ color: catColor }} strokeWidth={2.5} />
                        : <ArrowUpRight size={20} style={{ color: catColor }} strokeWidth={2.5} />}
                      {order.status !== 'complete' && order.status !== 'cancelled' && order.status !== 'expired' && (
                        <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
                          className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: catColor }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
                        <p style={{ fontSize: 14.5, fontWeight: 900, letterSpacing: '-0.02em', color: '#fff' }} className="truncate">
                          {isBuy ? 'Buying' : 'Selling'} {order.cryptoAmount} USDT
                        </p>
                        <p style={{ fontSize: 14.5, fontWeight: 900, marginLeft: 8, flexShrink: 0, color: isBuy ? '#f97316' : '#10b981' }}>
                          {isBuy ? '\u062F.\u0625' : '+\u062F.\u0625'}{parseFloat(order.fiatAmount).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 8, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '1px 7px', borderRadius: 99, background: '#000', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}>
                          {catLabel}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.25)' }}>
                          {order.merchant.name} \u00b7 Step {order.step}/4
                        </span>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-5">
        <div className={`${maxW} mx-auto`}>
          <div className="flex items-center justify-around px-2 py-2.5 rounded-[28px]"
            style={{ background: 'rgba(14,14,22,0.92)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.07)' }}>
            {([
              { key: "home",   icon: Home,          label: "Home" },
              { key: "wallet", icon: Wallet,        label: "Wallet" },
              { key: "trade",  icon: Zap,           label: "Trade" },
              { key: "orders", icon: Activity,      label: "Activity" },
              { key: "profile",icon: User,          label: "You" },
            ] as const).map(({ key, icon: Icon, label }) => {
              const on = screen === key;
              return (
                <motion.button key={key} whileTap={{ scale: 0.85 }} onClick={() => setScreen(key as Screen)}
                  className="relative flex flex-col items-center gap-1 px-3 py-1">
                  {on && (
                    <motion.div layoutId="blip-nav-pill" className="absolute inset-0 rounded-[18px]"
                      style={{ background: 'rgba(124,58,237,0.18)' }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
                  )}
                  <Icon size={19} strokeWidth={on ? 2.5 : 1.5} style={{ color: on ? '#a78bfa' : 'rgba(255,255,255,0.22)', position: 'relative' }} />
                  <span className="text-[8.5px] font-black uppercase tracking-wider relative z-10"
                    style={{ color: on ? '#a78bfa' : 'rgba(255,255,255,0.18)' }}>
                    {label}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
};
