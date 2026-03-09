"use client";

import { motion } from "framer-motion";
import {
  ArrowUpRight, ArrowDownLeft, ChevronDown, ChevronRight,
  Zap, Bell, TrendingUp, Plus, QrCode, Users, Wallet, Lock, Shield, Fingerprint,
} from "lucide-react";
import Sparkline from "./shared/Sparkline";
import Chip from "./shared/Chip";
import type { Order } from "@/types/user";

const TAP = { scale: 0.94 };

interface HomeScreenProps {
  userName: string;
  walletConnected: boolean;
  walletAddress: string | null;
  usdtBalance: number | null;
  orders: Order[];
  onNavigateProfile: () => void;
  onNavigateSend: () => void;
  onNavigateOrder: (orderId: string, isPending: boolean) => void;
  onConnectWallet: () => void;
  isEmbeddedWallet: boolean;
  embeddedWalletState?: 'none' | 'locked' | 'unlocked';
  onSetupWallet?: () => void;
  onUnlockWallet?: () => void;
}

export default function HomeScreen({
  userName,
  walletConnected,
  walletAddress,
  usdtBalance,
  orders,
  onNavigateProfile,
  onNavigateSend,
  onNavigateOrder,
  onConnectWallet,
  isEmbeddedWallet,
  embeddedWalletState,
  onSetupWallet,
  onUnlockWallet,
}: HomeScreenProps) {
  const pendingOrders = orders.filter(o => o.status !== "complete");
  const completedOrders = orders.filter(o => o.status === "complete");

  // Derive recent merchants from completed orders
  const recentMerchants = completedOrders
    .slice(0, 6)
    .reduce((acc: { id: string; name: string; initial: string }[], order) => {
      if (!acc.find(m => m.id === order.merchant.id)) {
        acc.push({ id: order.merchant.id, name: order.merchant.name, initial: order.merchant.name.charAt(0) });
      }
      return acc;
    }, []);

  // Compute stats
  const totalIn = completedOrders.filter(o => o.type === 'buy').reduce((s, o) => s + parseFloat(o.fiatAmount), 0);
  const totalOut = completedOrders.filter(o => o.type === 'sell').reduce((s, o) => s + parseFloat(o.fiatAmount), 0);
  const pendingCount = pendingOrders.length;

  // Build sparkline from order history
  const sparkData = completedOrders.length > 2
    ? completedOrders.slice(-14).map(o => parseFloat(o.cryptoAmount))
    : undefined;

  const handleWalletAction = () => {
    if (isEmbeddedWallet) {
      if (embeddedWalletState === 'locked') onUnlockWallet?.();
      else if (embeddedWalletState === 'none') onSetupWallet?.();
      else onConnectWallet();
    } else {
      onConnectWallet();
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <header className="px-5 pt-14 pb-3 flex items-center justify-between z-50">
        <div>
          <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.38em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase', marginBottom: 3 }}>
            Portfolio
          </p>
          <div className="flex items-center gap-1.5">
            <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.04em' }}>{userName}</span>
            <ChevronDown size={13} style={{ color: 'rgba(255,255,255,0.3)', marginTop: 1 }} />
          </div>
        </div>
        <div className="flex gap-2.5">
          <motion.button whileTap={TAP} className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <Bell size={15} style={{ color: 'rgba(255,255,255,0.4)' }} />
          </motion.button>
          <motion.button whileTap={TAP} onClick={onNavigateProfile}
            className="w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden"
            style={{ border: '2px solid rgba(124,58,237,0.45)', background: 'rgba(255,255,255,0.04)' }}>
            <span className="text-[14px] font-black text-white/70">{userName.charAt(0).toUpperCase()}</span>
          </motion.button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-28 no-scrollbar z-10" style={{ paddingLeft: 20, paddingRight: 20 }}>

        {/* Wallet Card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="relative mb-5">
          <div className="absolute inset-0 rounded-[40px] opacity-70" style={{
            background: 'radial-gradient(ellipse at 25% 35%, rgba(16,185,129,0.22) 0%, transparent 55%), radial-gradient(ellipse at 80% 75%, rgba(124,58,237,0.22) 0%, transparent 55%)',
            filter: 'blur(22px)', transform: 'scale(1.05)',
          }} />
          <div className="relative overflow-hidden rounded-[40px] cursor-pointer" onClick={handleWalletAction} style={{
            background: 'linear-gradient(148deg, #0b0e1a 0%, #12102c 42%, #0c1a2e 100%)',
            border: '1px solid rgba(255,255,255,0.085)',
            boxShadow: '0 28px 72px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.055)',
            minHeight: 252,
          }}>
            {/* Corner glows */}
            <div className="absolute" style={{ top: 0, left: 0, width: 180, height: 180, background: 'radial-gradient(circle, rgba(16,185,129,0.16) 0%, transparent 70%)', transform: 'translate(-38%, -38%)' }} />
            <div className="absolute" style={{ bottom: 0, right: 0, width: 180, height: 180, background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)', transform: 'translate(38%, 38%)' }} />
            {/* Dot grid */}
            <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '22px 22px', opacity: 0.4 }} />
            {/* Shimmer */}
            <motion.div
              animate={{ x: ['-220%', '220%'] }}
              transition={{ duration: 3.5, repeat: Infinity, repeatDelay: 5.5, ease: 'easeInOut' }}
              className="absolute inset-0 skew-x-12"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.035), transparent)' }}
            />

            <div className="relative z-10 p-6">
              {/* Top row */}
              <div className="flex justify-between items-start mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-[14px] flex items-center justify-center" style={{
                    background: 'linear-gradient(135deg, #059669, #7c3aed)',
                    boxShadow: '0 0 18px rgba(16,185,129,0.35)',
                  }}>
                    <Zap size={15} className="fill-white text-white" />
                  </div>
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.22em', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>BLIP</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: walletConnected ? '#10b981' : '#666', boxShadow: walletConnected ? '0 0 6px #10b981' : 'none' }} />
                      <span style={{ fontSize: 8, fontWeight: 900, color: walletConnected ? '#10b981' : '#666', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
                        {walletConnected ? 'Live' : 'Offline'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.18)', textTransform: 'uppercase' }}>USDT</p>
                  <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.18)', textTransform: 'uppercase' }}>Solana</p>
                </div>
              </div>

              {/* Balance */}
              <div className="mb-1">
                <p style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginBottom: 4 }}>Total Balance</p>
                <div className="flex items-baseline gap-0">
                  {walletConnected && usdtBalance !== null ? (
                    <>
                      <span style={{ fontSize: 54, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, color: '#fff' }}>
                        {usdtBalance >= 1000 ? `${(usdtBalance / 1000).toFixed(0)}` : usdtBalance.toFixed(0)}
                      </span>
                      {usdtBalance >= 1000 && (
                        <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em', color: 'rgba(255,255,255,0.25)', lineHeight: 1 }}>k</span>
                      )}
                      <span style={{ fontSize: 18, fontWeight: 900, color: 'rgba(255,255,255,0.15)', marginLeft: 8 }}>USDT</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 54, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, color: 'rgba(255,255,255,0.15)' }}>—</span>
                      <span style={{ fontSize: 18, fontWeight: 900, color: 'rgba(255,255,255,0.1)', marginLeft: 8 }}>USDT</span>
                    </>
                  )}
                </div>
              </div>

              {/* Trend badge */}
              {completedOrders.length > 0 && (
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{
                    background: 'rgba(16,185,129,0.13)', border: '1px solid rgba(16,185,129,0.3)',
                  }}>
                    <TrendingUp size={9} style={{ color: '#10b981' }} />
                    <span style={{ fontSize: 10, fontWeight: 900, color: '#10b981' }}>{completedOrders.length} trades</span>
                  </div>
                  <span style={{ fontSize: 8.5, fontWeight: 700, color: 'rgba(255,255,255,0.18)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                    completed
                  </span>
                </div>
              )}

              {/* Sparkline */}
              <div className="mb-4" style={{ marginLeft: -4, marginRight: -4 }}>
                <Sparkline data={sparkData} />
              </div>

              {/* Bottom row */}
              <div className="flex justify-between items-center">
                <div>
                  <p style={{ fontSize: 7, fontWeight: 900, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.18)', textTransform: 'uppercase', marginBottom: 2 }}>Address</p>
                  <p style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: 'rgba(255,255,255,0.45)' }}>
                    {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Not connected'}
                  </p>
                </div>
                {walletConnected ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl"
                    style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} />
                    <span style={{ fontSize: 9, fontWeight: 900, color: '#10b981' }}>SOL</span>
                  </div>
                ) : isEmbeddedWallet && embeddedWalletState === 'locked' ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl"
                    style={{ background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.2)' }}>
                    <Lock size={10} style={{ color: '#fb923c' }} />
                    <span style={{ fontSize: 9, fontWeight: 900, color: '#fb923c' }}>LOCKED</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <Wallet size={10} style={{ color: 'rgba(255,255,255,0.3)' }} />
                    <span style={{ fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.3)' }}>CONNECT</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Quick Stats */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="flex gap-2.5 mb-6">
          <Chip label="Total In" value={`+${totalIn > 1000 ? `${(totalIn/1000).toFixed(1)}k` : totalIn.toFixed(0)} AED`} color="#10b981" />
          <Chip label="Total Out" value={`-${totalOut > 1000 ? `${(totalOut/1000).toFixed(1)}k` : totalOut.toFixed(0)} AED`} color="#f87171" />
          <Chip label="Pending" value={`${pendingCount} txns`} color="#fbbf24" />
        </motion.div>

        {/* Wallet Prompt - shown when no wallet */}
        {!walletConnected && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
            className="rounded-[24px] mb-6 overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(16,185,129,0.06) 100%)', border: '1px solid rgba(124,58,237,0.12)' }}>
            <div className="p-4 flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(16,185,129,0.2))', border: '1px solid rgba(124,58,237,0.2)' }}>
                {isEmbeddedWallet && embeddedWalletState === 'locked'
                  ? <Lock size={20} style={{ color: '#fb923c' }} />
                  : <Shield size={20} style={{ color: '#a78bfa' }} />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.02em', color: '#fff', marginBottom: 3 }}>
                  {isEmbeddedWallet
                    ? embeddedWalletState === 'locked' ? 'Unlock Wallet' : 'Create Wallet'
                    : 'Connect Wallet'
                  }
                </p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', lineHeight: 1.4, marginBottom: 10 }}>
                  {isEmbeddedWallet
                    ? embeddedWalletState === 'locked'
                      ? 'Enter your password to access your wallet'
                      : 'Set up an in-app wallet to start trading on-chain with escrow protection'
                    : 'Link a Solana wallet to enable secure on-chain escrow'
                  }
                </p>
                <motion.button whileTap={TAP} onClick={handleWalletAction}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
                  style={{ background: '#fff', boxShadow: '0 4px 20px rgba(255,255,255,0.1)' }}>
                  <Fingerprint size={14} style={{ color: '#000' }} />
                  <span style={{ fontSize: 12, fontWeight: 900, color: '#000' }}>
                    {isEmbeddedWallet
                      ? embeddedWalletState === 'locked' ? 'Unlock' : 'Create Wallet'
                      : 'Connect'
                    }
                  </span>
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Actions */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13 }}
          className="grid grid-cols-4 gap-2 mb-8">
          {[
            { label: 'Send', Icon: ArrowUpRight, primary: true, fn: onNavigateSend },
            { label: 'Receive', Icon: ArrowDownLeft, primary: false, fn: () => {} },
            { label: 'Add', Icon: Plus, primary: false, fn: handleWalletAction },
            { label: 'Scan', Icon: QrCode, primary: false, fn: () => {} },
          ].map(({ label, Icon, primary, fn }) => (
            <motion.button key={label} whileTap={TAP} onClick={fn} className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={
                primary
                  ? { background: '#ffffff', boxShadow: '0 8px 28px rgba(255,255,255,0.12)' }
                  : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }
              }>
                <Icon size={21} strokeWidth={2.5} style={{ color: primary ? '#000' : 'rgba(255,255,255,0.45)' }} />
              </div>
              <span style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em',
                color: primary ? '#fff' : 'rgba(255,255,255,0.3)' }}>{label}</span>
            </motion.button>
          ))}
        </motion.div>

        {/* Active Order Banner */}
        {pendingOrders.length > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileTap={TAP}
            onClick={() => onNavigateOrder(pendingOrders[0].id, pendingOrders[0].status === "pending")}
            className="w-full flex items-center gap-3 rounded-[22px] mb-6"
            style={{ padding: '12px 14px', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)' }}
          >
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(124,58,237,0.15)' }}>
              <motion.div
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: '#a78bfa' }}
                animate={{ opacity: [1, 0.3, 1], scale: [1, 1.3, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            </div>
            <div className="flex-1 text-left">
              <p style={{ fontSize: 14.5, fontWeight: 900, letterSpacing: '-0.02em', color: '#fff' }}>
                {pendingOrders[0].type === "buy" ? "Buying" : "Selling"} {pendingOrders[0].cryptoAmount} USDC
              </p>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)' }}>
                {pendingOrders[0].status === "pending" ? "Finding merchant..." : `Step ${pendingOrders[0].step} of 4`}
              </p>
            </div>
            <ChevronRight size={18} style={{ color: 'rgba(255,255,255,0.2)' }} />
          </motion.button>
        )}

        {/* Circle - Recent Merchants */}
        {recentMerchants.length > 0 && (
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase' }}>Circle</p>
              <Users size={14} style={{ color: 'rgba(255,255,255,0.18)' }} />
            </div>
            <div className="flex gap-4 overflow-x-auto no-scrollbar" style={{ marginLeft: -4, paddingLeft: 4, paddingRight: 4 }}>
              {recentMerchants.map((m, i) => (
                <motion.div key={m.id}
                  initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.18 + i * 0.06 }}
                  className="flex flex-col items-center gap-2 shrink-0">
                  <div style={{ padding: 2, borderRadius: 24, background: 'linear-gradient(135deg, #10b981, #7c3aed)' }}>
                    <div className="w-14 h-14 rounded-[22px] flex items-center justify-center"
                      style={{ background: '#12102c' }}>
                      <span className="text-[18px] font-black text-white/60">{m.initial}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)' }}>{m.name.split(' ')[0]}</span>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Pulse - Order Feed */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase' }}>Recent Pulse</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {orders.slice(0, 5).map((order, i) => (
              <motion.div key={order.id}
                initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.22 + i * 0.07 }}
                whileTap={TAP}
                onClick={() => onNavigateOrder(order.id, false)}
                className="flex items-center gap-3 rounded-[22px] cursor-pointer"
                style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="relative shrink-0 rounded-2xl overflow-hidden flex items-center justify-center" style={{
                  width: 48, height: 48,
                  background: order.type === 'buy' ? 'rgba(16,185,129,0.1)' : 'rgba(124,58,237,0.1)',
                }}>
                  {order.type === 'buy'
                    ? <ArrowDownLeft size={20} style={{ color: '#10b981' }} />
                    : <ArrowUpRight size={20} style={{ color: '#a78bfa' }} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
                    <p style={{ fontSize: 14.5, fontWeight: 900, letterSpacing: '-0.02em', color: '#fff' }} className="truncate">
                      {order.merchant.name}
                    </p>
                    <p style={{ fontSize: 14.5, fontWeight: 900, marginLeft: 8, flexShrink: 0,
                      color: order.type === 'buy' ? '#10b981' : '#a78bfa' }}>
                      {order.type === 'buy' ? '+' : '-'}{order.cryptoAmount} USDC
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 8, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em',
                      padding: '1px 7px', borderRadius: 99,
                      background: order.type === 'buy' ? 'rgba(16,185,129,0.1)' : 'rgba(124,58,237,0.1)',
                      color: order.type === 'buy' ? '#10b981' : '#a78bfa',
                      border: order.type === 'buy' ? '1px solid rgba(16,185,129,0.25)' : '1px solid rgba(124,58,237,0.25)',
                    }}>
                      {order.type === 'buy' ? 'Buy' : 'Sell'}
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.25)' }}>
                      د.إ {parseFloat(order.fiatAmount).toLocaleString()} · {order.dbStatus || order.status}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
            {orders.length === 0 && (
              <div className="text-center py-8">
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.15)', fontWeight: 600 }}>No trades yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
