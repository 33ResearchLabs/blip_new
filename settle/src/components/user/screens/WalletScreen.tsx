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
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6 bg-surface-hover border border-border-strong">
            <Wallet size={36} className="text-text-primary" />
          </div>
          <h2 className="text-xl font-black mb-2 text-text-primary">Set Up Wallet</h2>
          <p className="text-sm text-center mb-8 text-text-tertiary">
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
            className="px-8 py-3.5 rounded-2xl text-[15px] font-bold bg-accent text-accent-text">
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
        <h1 className="text-[20px] font-black tracking-tight text-text-primary">Wallet</h1>
        <motion.button whileTap={{ scale: 0.9 }} onClick={handleRefresh}
          className="w-9 h-9 rounded-xl flex items-center justify-center bg-surface-card border border-border-subtle">
          <RefreshCw size={15} className={`${isRefreshing ? 'animate-spin' : ''} text-text-tertiary`} />
        </motion.button>
      </header>

      <div className="flex-1 overflow-y-auto pb-28 no-scrollbar px-5">
        {/* Balance Card */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="relative rounded-[32px] overflow-hidden mb-5 border border-border-medium shadow-[0_28px_72px_rgba(0,0,0,0.7)] bg-gradient-to-b from-surface-raised to-surface-base">
          <div
            className="absolute top-0 left-0 w-40 h-40 -translate-x-[38%] -translate-y-[38%]"
            style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.14) 0%, transparent 70%)' }}
          />
          <div
            className="absolute bottom-0 right-0 w-40 h-40 translate-x-[38%] translate-y-[38%]"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)' }}
          />

          <div className="relative z-10 p-6">
            <p className="text-[9px] font-black tracking-[0.3em] text-text-tertiary uppercase mb-2">USDT Balance</p>
            <div className="flex items-baseline gap-0 mb-1">
              <span className="text-[48px] font-black tracking-[-0.04em] leading-none text-text-primary">
                {solanaWallet.usdtBalance !== null ? Math.floor(solanaWallet.usdtBalance).toLocaleString() : '0'}
              </span>
              <span className="text-[24px] font-black tracking-[-0.02em] text-text-tertiary leading-none">
                {solanaWallet.usdtBalance !== null ? '.' + (solanaWallet.usdtBalance % 1).toFixed(2).slice(2) : '.00'}
              </span>
            </div>

            <div className="flex items-center gap-3 mt-3 mb-5">
              <div className="px-2.5 py-1 rounded-full bg-surface-card border border-border-subtle">
                <span className="text-[11px] font-bold text-text-tertiary">
                  SOL: {solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : '0'}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowSend(true)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-surface-active border border-border-medium">
                <ArrowUpFromLine size={16} className="text-text-primary" />
                <span className="text-[13px] font-extrabold text-text-primary">Send</span>
              </motion.button>
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowReceive(true)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-surface-active border border-border-medium">
                <ArrowDownToLine size={16} className="text-text-primary" />
                <span className="text-[13px] font-extrabold text-text-primary">Receive</span>
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* Address Card */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="rounded-[22px] p-4 mb-4 bg-surface-card border border-border-subtle">
          <p className="text-[8px] font-black tracking-[0.25em] text-text-tertiary uppercase mb-2">Wallet Address</p>
          <div className="flex items-center gap-2">
            <p className="flex-1 font-mono text-[12px] truncate text-text-secondary">
              {solanaWallet.walletAddress || '—'}
            </p>
            <motion.button whileTap={{ scale: 0.85 }} onClick={handleCopy}
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-surface-card">
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} className="text-text-tertiary" />}
            </motion.button>
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="grid grid-cols-2 gap-3 mb-4">
          {/* Airdrop (devnet) */}
          {solanaWallet.requestAirdrop && (
            <motion.button whileTap={{ scale: 0.95 }} onClick={handleAirdrop} disabled={isAirdropping}
              className="flex items-center gap-3 rounded-[18px] p-3.5 bg-surface-card border border-border-subtle">
              {isAirdropping
                ? <Loader2 size={18} className="animate-spin text-info" />
                : <Droplets size={18} className="text-text-primary" />}
              <div className="text-left">
                <p className="text-[12px] font-extrabold text-text-primary">Airdrop</p>
                <p className="text-[9px] text-text-tertiary">Free SOL</p>
              </div>
            </motion.button>
          )}
          {/* Explorer */}
          {solanaWallet.walletAddress && (
            <motion.button whileTap={{ scale: 0.95 }}
              onClick={() => window.open(`https://explorer.solana.com/address/${solanaWallet.walletAddress}?cluster=devnet`, '_blank')}
              className="flex items-center gap-3 rounded-[18px] p-3.5 bg-surface-card border border-border-subtle">
              <ExternalLink size={18} className="text-info" />
              <div className="text-left">
                <p className="text-[12px] font-extrabold text-text-primary">Explorer</p>
                <p className="text-[9px] text-text-tertiary">View on-chain</p>
              </div>
            </motion.button>
          )}
        </motion.div>

        {/* Airdrop message */}
        {airdropMsg && (
          <p className={`text-center text-sm mb-4 ${airdropMsg.includes('received') ? 'text-success' : 'text-error'}`}>
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
              className="w-full max-w-sm rounded-t-3xl p-6 bg-surface-base border-t border-border-subtle">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black text-text-primary">Send</h3>
                <button onClick={() => { setShowSend(false); setSendError(''); setSendSuccess(''); }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-card">
                  <X size={16} className="text-text-tertiary" />
                </button>
              </div>

              {/* Token toggle */}
              <div className="flex gap-2 mb-4">
                {(['USDT', 'SOL'] as const).map(t => (
                  <button key={t} onClick={() => setSendToken(t)}
                    className={`flex-1 py-2 rounded-xl text-sm font-bold ${
                      sendToken === t
                        ? 'bg-surface-hover border border-border-strong text-text-primary'
                        : 'bg-surface-card border border-border-subtle text-text-tertiary'
                    }`}>
                    {t}
                  </button>
                ))}
              </div>

              <input
                type="text" placeholder="Recipient address" value={sendTo}
                onChange={e => setSendTo(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm mb-3 outline-none bg-surface-card border border-border-subtle text-text-primary"
              />
              <input
                type="number" placeholder="Amount" value={sendAmount}
                onChange={e => setSendAmount(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm mb-3 outline-none bg-surface-card border border-border-subtle text-text-primary"
              />

              <p className="text-xs mb-4 text-text-tertiary">
                Available: {sendToken === 'USDT'
                  ? `${solanaWallet.usdtBalance?.toFixed(2) ?? '0'} USDT`
                  : `${solanaWallet.solBalance?.toFixed(4) ?? '0'} SOL`}
              </p>

              {sendError && <p className="text-xs text-error mb-3">{sendError}</p>}
              {sendSuccess && <p className="text-xs text-success mb-3">{sendSuccess}</p>}

              <motion.button whileTap={{ scale: 0.97 }} onClick={handleSend} disabled={isSending}
                className={`w-full py-3.5 rounded-2xl text-[15px] font-bold ${
                  isSending ? 'bg-surface-card text-text-tertiary' : 'bg-accent text-accent-text'
                }`}>
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
              className="w-full max-w-sm rounded-t-3xl p-6 bg-surface-base border-t border-border-subtle">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black text-text-primary">Receive</h3>
                <button onClick={() => setShowReceive(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-card">
                  <X size={16} className="text-text-tertiary" />
                </button>
              </div>

              <p className="text-xs mb-4 text-center text-text-tertiary">
                Send USDT or SOL to this address on Solana (Devnet)
              </p>

              <div className="rounded-2xl p-4 mb-4 bg-surface-card border border-border-subtle">
                <p className="font-mono text-[12px] break-all text-center leading-relaxed text-text-secondary">
                  {solanaWallet.walletAddress}
                </p>
              </div>

              <motion.button whileTap={{ scale: 0.97 }} onClick={handleCopy}
                className="w-full py-3.5 rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 bg-surface-active border border-border-medium text-text-primary">
                {copied ? <><Check size={16} className="text-success" /> Copied!</> : <><Copy size={16} /> Copy Address</>}
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </>
  );
};
