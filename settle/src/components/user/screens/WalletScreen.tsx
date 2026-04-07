"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wallet,
  Copy,
  Check,
  ArrowUpFromLine,
  ArrowDownToLine,
  RefreshCw,
  Droplets,
  Loader2,
  X,
  ExternalLink,
} from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { colors, sectionLabel, mono } from "@/lib/design/theme";
import { BottomNav } from "./BottomNav";
import type { Screen } from "./types";

export interface WalletScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  solanaWallet: {
    connected: boolean;
    walletAddress: string | null;
    solBalance: number | null;
    usdtBalance: number | null;
    refreshBalances: () => Promise<void>;
    sendUsdt?: (to: string, amount: number) => Promise<{ success: boolean; txHash?: string; error?: string }>;
    sendSol?: (to: string, amount: number) => Promise<{ success: boolean; txHash?: string; error?: string }>;
    requestAirdrop?: () => Promise<{ success: boolean; error?: string }>;
  };
  embeddedWallet?: {
    state: 'none' | 'locked' | 'unlocked';
  };
  setShowWalletModal: (v: boolean) => void;
  setShowWalletSetup: (v: boolean) => void;
  setShowWalletUnlock: (v: boolean) => void;
  maxW: string;
}

export const WalletScreen = ({
  screen,
  setScreen,
  solanaWallet,
  embeddedWallet,
  setShowWalletModal,
  setShowWalletSetup,
  setShowWalletUnlock,
  maxW,
}: WalletScreenProps) => {
  const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAirdropping, setIsAirdropping] = useState(false);
  const [airdropMsg, setAirdropMsg] = useState('');

  // Send modal state
  const [showSend, setShowSend] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendToken, setSendToken] = useState<'USDT' | 'SOL'>('USDT');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');

  // Receive modal state
  const [showReceive, setShowReceive] = useState(false);

  const handleCopy = async () => {
    if (!solanaWallet.walletAddress) return;
    const ok = await copyToClipboard(solanaWallet.walletAddress);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await solanaWallet.refreshBalances();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const handleAirdrop = async () => {
    if (!solanaWallet.requestAirdrop) return;
    setIsAirdropping(true);
    setAirdropMsg('');
    try {
      const result = await solanaWallet.requestAirdrop();
      if (result.success) {
        setAirdropMsg('Airdrop received!');
        await solanaWallet.refreshBalances();
      } else {
        setAirdropMsg(result.error || 'Airdrop failed');
      }
    } catch {
      setAirdropMsg('Airdrop failed');
    }
    setIsAirdropping(false);
    setTimeout(() => setAirdropMsg(''), 3000);
  };

  const handleSend = async () => {
    setSendError('');
    setSendSuccess('');
    if (!sendTo.trim()) { setSendError('Enter recipient address'); return; }
    if (!sendAmount || parseFloat(sendAmount) <= 0) { setSendError('Enter a valid amount'); return; }

    setIsSending(true);
    try {
      const fn = sendToken === 'USDT' ? solanaWallet.sendUsdt : solanaWallet.sendSol;
      if (!fn) { setSendError('Send not available'); setIsSending(false); return; }
      const result = await fn(sendTo.trim(), parseFloat(sendAmount));
      if (result.success) {
        setSendSuccess(`Sent! TX: ${result.txHash?.slice(0, 8)}...`);
        await solanaWallet.refreshBalances();
        setTimeout(() => { setShowSend(false); setSendTo(''); setSendAmount(''); setSendSuccess(''); }, 2000);
      } else {
        setSendError(result.error || 'Send failed');
      }
    } catch (err: any) {
      setSendError(err.message || 'Send failed');
    }
    setIsSending(false);
  };

  // Not connected state
  if (!solanaWallet.connected) {
    return (
      <>
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6"
            style={{ background: colors.accent.subtle, border: `1px solid ${colors.accent.primary}` }}>
            <Wallet size={36} style={{ color: colors.accent.primary }} />
          </div>
          <h2 className="text-xl font-black mb-2" style={{ color: colors.text.primary }}>Set Up Wallet</h2>
          <p className="text-sm text-center mb-8" style={{ color: colors.text.tertiary }}>
            Connect or create a Solana wallet to send, receive, and trade USDT.
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
            className="px-8 py-3.5 rounded-2xl text-[15px] font-bold"
            style={{ background: colors.accent.primary, color: colors.accent.text }}>
            {IS_EMBEDDED_WALLET
              ? embeddedWallet?.state === 'locked' ? 'Unlock Wallet' : 'Create Wallet'
              : 'Connect Wallet'}
          </button>
        </div>
        <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
      </>
    );
  }

  return (
    <>
      <div className="h-12" />

      {/* Header */}
      <header className="px-5 pt-2 pb-4 flex items-center justify-between">
        <h1 className="text-[20px] font-black tracking-tight" style={{ color: colors.text.primary }}>Wallet</h1>
        <motion.button whileTap={{ scale: 0.9 }} onClick={handleRefresh}
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: colors.surface.glass, border: `1px solid ${colors.border.subtle}` }}>
          <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} style={{ color: colors.text.tertiary }} />
        </motion.button>
      </header>

      <div className="flex-1 overflow-y-auto pb-28 no-scrollbar px-5">
        {/* Balance Card */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="relative rounded-[32px] overflow-hidden mb-5"
          style={{
            background: `linear-gradient(148deg, ${colors.bg.secondary} 0%, ${colors.bg.primary} 100%)`,
            border: `1px solid ${colors.border.medium}`,
            boxShadow: '0 28px 72px rgba(0,0,0,0.7)',
          }}>
          <div className="absolute" style={{ top: 0, left: 0, width: 160, height: 160, background: 'radial-gradient(circle, rgba(16,185,129,0.14) 0%, transparent 70%)', transform: 'translate(-38%, -38%)' }} />
          <div className="absolute" style={{ bottom: 0, right: 0, width: 160, height: 160, background: `radial-gradient(circle, ${colors.accent.glow} 0%, transparent 70%)`, transform: 'translate(38%, 38%)' }} />

          <div className="relative z-10 p-6">
            <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: colors.text.tertiary, textTransform: 'uppercase', marginBottom: 8 }}>USDT Balance</p>
            <div className="flex items-baseline gap-0 mb-1">
              <span style={{ fontSize: 48, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, color: colors.text.primary }}>
                {solanaWallet.usdtBalance !== null ? Math.floor(solanaWallet.usdtBalance).toLocaleString() : '0'}
              </span>
              <span style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.02em', color: colors.text.tertiary, lineHeight: 1 }}>
                {solanaWallet.usdtBalance !== null ? '.' + (solanaWallet.usdtBalance % 1).toFixed(2).slice(2) : '.00'}
              </span>
            </div>

            <div className="flex items-center gap-3 mt-3 mb-5">
              <div className="px-2.5 py-1 rounded-full" style={{ background: colors.surface.glass, border: `1px solid ${colors.border.subtle}` }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: colors.text.tertiary }}>
                  SOL: {solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : '0'}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowSend(true)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl"
                style={{ background: colors.surface.active, border: `1px solid ${colors.border.medium}` }}>
                <ArrowUpFromLine size={16} style={{ color: colors.text.primary }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: colors.text.primary }}>Send</span>
              </motion.button>
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowReceive(true)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl"
                style={{ background: colors.surface.active, border: `1px solid ${colors.border.medium}` }}>
                <ArrowDownToLine size={16} style={{ color: colors.text.primary }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: colors.text.primary }}>Receive</span>
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* Address Card */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="rounded-[22px] p-4 mb-4"
          style={{ background: colors.surface.glass, border: `1px solid ${colors.border.subtle}` }}>
          <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.25em', color: colors.text.tertiary, textTransform: 'uppercase', marginBottom: 8 }}>Wallet Address</p>
          <div className="flex items-center gap-2">
            <p className="flex-1 font-mono text-[12px] truncate" style={{ color: colors.text.secondary }}>
              {solanaWallet.walletAddress || '—'}
            </p>
            <motion.button whileTap={{ scale: 0.85 }} onClick={handleCopy}
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: colors.surface.glass }}>
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} style={{ color: colors.text.tertiary }} />}
            </motion.button>
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="grid grid-cols-2 gap-3 mb-4">
          {/* Airdrop (devnet) */}
          {solanaWallet.requestAirdrop && (
            <motion.button whileTap={{ scale: 0.95 }} onClick={handleAirdrop} disabled={isAirdropping}
              className="flex items-center gap-3 rounded-[18px] p-3.5"
              style={{ background: colors.surface.glass, border: `1px solid ${colors.border.subtle}` }}>
              {isAirdropping
                ? <Loader2 size={18} className="animate-spin text-purple-400" />
                : <Droplets size={18} style={{ color: colors.accent.bright }} />}
              <div className="text-left">
                <p style={{ fontSize: 12, fontWeight: 800, color: colors.text.primary }}>Airdrop</p>
                <p style={{ fontSize: 9, color: colors.text.tertiary }}>Free SOL</p>
              </div>
            </motion.button>
          )}
          {/* Explorer */}
          {solanaWallet.walletAddress && (
            <motion.button whileTap={{ scale: 0.95 }}
              onClick={() => window.open(`https://explorer.solana.com/address/${solanaWallet.walletAddress}?cluster=devnet`, '_blank')}
              className="flex items-center gap-3 rounded-[18px] p-3.5"
              style={{ background: colors.surface.glass, border: `1px solid ${colors.border.subtle}` }}>
              <ExternalLink size={18} style={{ color: colors.info }} />
              <div className="text-left">
                <p style={{ fontSize: 12, fontWeight: 800, color: colors.text.primary }}>Explorer</p>
                <p style={{ fontSize: 9, color: colors.text.tertiary }}>View on-chain</p>
              </div>
            </motion.button>
          )}
        </motion.div>

        {/* Airdrop message */}
        {airdropMsg && (
          <p className="text-center text-sm mb-4" style={{ color: airdropMsg.includes('received') ? '#10b981' : '#f87171' }}>
            {airdropMsg}
          </p>
        )}
      </div>

      {/* Send Modal */}
      <AnimatePresence>
        {showSend && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end justify-center">
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full max-w-sm rounded-t-3xl p-6"
              style={{ background: `linear-gradient(${colors.surface.card}, ${colors.surface.card}), ${colors.bg.primary}`, borderTop: `1px solid ${colors.border.subtle}` }}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black" style={{ color: colors.text.primary }}>Send</h3>
                <button onClick={() => { setShowSend(false); setSendError(''); setSendSuccess(''); }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: colors.surface.card }}>
                  <X size={16} style={{ color: colors.text.tertiary }} />
                </button>
              </div>

              {/* Token toggle */}
              <div className="flex gap-2 mb-4">
                {(['USDT', 'SOL'] as const).map(t => (
                  <button key={t} onClick={() => setSendToken(t)}
                    className="flex-1 py-2 rounded-xl text-sm font-bold"
                    style={sendToken === t
                      ? { background: colors.accent.subtle, border: `1px solid ${colors.accent.border}`, color: colors.accent.primary }
                      : { background: colors.surface.card, border: `1px solid ${colors.border.subtle}`, color: colors.text.tertiary }}>
                    {t}
                  </button>
                ))}
              </div>

              <input
                type="text" placeholder="Recipient address" value={sendTo}
                onChange={e => setSendTo(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm mb-3 outline-none"
                style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}`, color: colors.text.primary }}
              />
              <input
                type="number" placeholder="Amount" value={sendAmount}
                onChange={e => setSendAmount(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm mb-3 outline-none"
                style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}`, color: colors.text.primary }}
              />

              <p className="text-xs mb-4" style={{ color: colors.text.tertiary }}>
                Available: {sendToken === 'USDT'
                  ? `${solanaWallet.usdtBalance?.toFixed(2) ?? '0'} USDT`
                  : `${solanaWallet.solBalance?.toFixed(4) ?? '0'} SOL`}
              </p>

              {sendError && <p className="text-xs text-red-400 mb-3">{sendError}</p>}
              {sendSuccess && <p className="text-xs text-emerald-400 mb-3">{sendSuccess}</p>}

              <motion.button whileTap={{ scale: 0.97 }} onClick={handleSend} disabled={isSending}
                className="w-full py-3.5 rounded-2xl text-[15px] font-bold"
                style={{ background: isSending ? colors.surface.card : colors.accent.primary, color: isSending ? colors.text.tertiary : colors.accent.text }}>
                {isSending ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Send'}
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Receive Modal */}
      <AnimatePresence>
        {showReceive && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end justify-center">
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full max-w-sm rounded-t-3xl p-6"
              style={{ background: `linear-gradient(${colors.surface.card}, ${colors.surface.card}), ${colors.bg.primary}`, borderTop: `1px solid ${colors.border.subtle}` }}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black" style={{ color: colors.text.primary }}>Receive</h3>
                <button onClick={() => setShowReceive(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: colors.surface.card }}>
                  <X size={16} style={{ color: colors.text.tertiary }} />
                </button>
              </div>

              <p className="text-xs mb-4 text-center" style={{ color: colors.text.tertiary }}>
                Send USDT or SOL to this address on Solana (Devnet)
              </p>

              <div className="rounded-2xl p-4 mb-4" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
                <p className="font-mono text-[12px] break-all text-center leading-relaxed" style={{ color: colors.text.secondary }}>
                  {solanaWallet.walletAddress}
                </p>
              </div>

              <motion.button whileTap={{ scale: 0.97 }} onClick={handleCopy}
                className="w-full py-3.5 rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2"
                style={{ background: colors.surface.active, border: `1px solid ${colors.border.medium}`, color: colors.text.primary }}>
                {copied ? <><Check size={16} className="text-emerald-500" /> Copied!</> : <><Copy size={16} /> Copy Address</>}
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </>
  );
};