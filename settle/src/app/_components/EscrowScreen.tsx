"use client";

import { motion } from "framer-motion";
import {
  ChevronLeft,
  Shield,
  Banknote,
  AlertTriangle,
  Lock,
  ExternalLink,
  Clock,
  Loader2,
} from "lucide-react";
import AmbientGlow from "@/components/user/shared/AmbientGlow";

interface EscrowScreenProps {
  maxW: string;
  amount: string;
  fiatAmount: number;
  currentRate: any;
  userBankAccount: string;
  setUserBankAccount: (v: string) => void;
  escrowError: string | null;
  setEscrowError: (v: string | null) => void;
  escrowTxStatus: any;
  setEscrowTxStatus: (v: any) => void;
  escrowTxHash: string | null;
  isLoading: boolean;
  setScreen: (s: any) => void;
  setShowWalletModal: (v: boolean) => void;
  confirmEscrow: () => void;
  solanaWallet: any;
}

export function EscrowScreen(props: EscrowScreenProps) {
  const {
    maxW,
    amount,
    fiatAmount,
    currentRate,
    userBankAccount,
    setUserBankAccount,
    escrowError,
    setEscrowError,
    escrowTxStatus,
    setEscrowTxStatus,
    escrowTxHash,
    isLoading,
    setScreen,
    setShowWalletModal,
    confirmEscrow,
    solanaWallet,
  } = props;

  return (
    <motion.div
      key="escrow"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={`flex-1 w-full ${maxW} flex flex-col`}
      style={{ background: '#06060e' }}
    >
      <AmbientGlow />
      <div className="h-12" />

      <div className="px-5 py-4 flex items-center z-10">
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { setScreen("home"); setEscrowTxStatus('idle'); setEscrowError(null); }}
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <ChevronLeft size={18} style={{ color: 'rgba(255,255,255,0.5)' }} />
        </motion.button>
        <p className="flex-1 text-center pr-9" style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' }}>Confirm Escrow</p>
      </div>

      <div className="flex-1 px-5 flex flex-col z-10">
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="w-20 h-20 rounded-[28px] flex items-center justify-center mb-6"
            style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(16,185,129,0.15))', border: '1px solid rgba(124,58,237,0.2)' }}>
            <Shield className="w-10 h-10" style={{ color: '#a78bfa' }} />
          </motion.div>
          <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', color: '#fff', marginBottom: 8 }}>Lock {amount} USDT</h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', marginBottom: 24, maxWidth: 280 }}>
            Your USDT will be held securely on Solana until you confirm receiving payment
          </p>

          {/* Wallet Status */}
          <div className="w-full rounded-2xl p-4 mb-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}>
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-neutral-500">Wallet</span>
              {solanaWallet.connected ? (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-white/10" />
                  <span className="text-[14px] text-white font-mono">
                    {solanaWallet.walletAddress?.slice(0, 4)}...{solanaWallet.walletAddress?.slice(-4)}
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => setShowWalletModal(true)}
                  className="text-[14px] text-violet-400 font-medium"
                >
                  Connect Wallet
                </button>
              )}
            </div>
            {solanaWallet.connected && (
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-neutral-800">
                <span className="text-[15px] text-neutral-500">Balance</span>
                <span className={`text-[15px] font-medium ${
                  solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance >= parseFloat(amount || '0')
                    ? 'text-white'
                    : 'text-red-400'
                }`}>
                  {solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '...'} USDT
                </span>
              </div>
            )}
          </div>

          {/* Order Details */}
          <div className="w-full rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}>
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-neutral-500">Amount to Lock</span>
              <span className="text-[15px] font-medium text-white">{amount} USDT</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-neutral-500">You'll receive</span>
              <span className="text-[15px] font-medium text-white">د.إ {fiatAmount.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-neutral-500">Rate</span>
              <span className="text-[15px] text-neutral-400">1 USDT = {currentRate} AED</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-neutral-500">Network</span>
              <span className="text-[14px] text-violet-400">Solana Devnet</span>
            </div>
          </div>

          {/* Bank Account Note - where merchant will send fiat */}
          <div className="w-full rounded-2xl p-3 mt-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Banknote className="w-4 h-4 text-neutral-500" />
              <span className="text-[12px] text-neutral-500">Payment details for merchant</span>
            </div>
            <textarea
              value={userBankAccount}
              onChange={(e) => setUserBankAccount(e.target.value)}
              placeholder="Enter your bank IBAN or payment details..."
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-[13px] text-white outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            />
          </div>

          {/* Program Not Ready Warning - shows when wallet connected but Anchor program failed to initialize */}
          {solanaWallet.connected && !solanaWallet.programReady && (
            <div className="w-full mt-4 bg-white/5 border border-white/6 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-white/70 flex-shrink-0 mt-0.5" />
                <div className="text-left flex-1">
                  <p className="text-[14px] text-white/70 font-medium">Wallet Needs Reconnection</p>
                  <p className="text-[13px] text-neutral-400 mt-1">
                    The escrow program is not ready. Please reconnect your wallet.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    solanaWallet.disconnect();
                    setTimeout(() => setShowWalletModal(true), 100);
                  }}
                  className="flex-1 py-2 rounded-lg bg-white/10 text-[14px] text-white/70 font-medium"
                >
                  Reconnect Wallet
                </button>
                <button
                  onClick={() => solanaWallet.reinitializeProgram()}
                  className="py-2 px-4 rounded-lg bg-neutral-800 text-[14px] text-neutral-300"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Error Message */}
          {escrowError && (
            <div className="w-full mt-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-left">
                  <p className="text-[14px] text-red-400 font-medium">Transaction Failed</p>
                  <p className="text-[13px] text-neutral-400 mt-1">{escrowError}</p>
                </div>
              </div>
              <button
                onClick={() => { setEscrowError(null); setEscrowTxStatus('idle'); }}
                className="w-full mt-3 py-2 rounded-lg bg-neutral-800 text-[14px] text-neutral-300"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Show waiting state after success */}
        {escrowTxStatus === 'success' ? (
          <div className="pb-10 space-y-4">
            {/* Success indicator */}
            <div className="bg-white/5 border border-white/6 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-white">Escrow Locked</p>
                  <p className="text-[13px] text-neutral-400">Your USDC is secured on-chain</p>
                </div>
              </div>
              {escrowTxHash && (
                <a
                  href={`https://explorer.solana.com/tx/${escrowTxHash}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[13px] text-white/50 hover:text-white"
                >
                  View Transaction <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* Waiting for merchant */}
            <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-white/70" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-medium text-white">Waiting for merchant</p>
                  <p className="text-[13px] text-neutral-500">Merchant will accept and send fiat to your bank</p>
                </div>
              </div>
              <div className="mt-3 h-1 bg-neutral-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-white/10"
                  animate={{ x: ["-100%", "100%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  style={{ width: "30%" }}
                />
              </div>
            </div>

            {/* Go to order details */}
            <button
              onClick={() => setScreen("order")}
              className="w-full py-3 rounded-xl bg-neutral-800 text-[15px] font-medium text-white"
            >
              View Order Details
            </button>
          </div>
        ) : (
          <div className="pb-10">
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={confirmEscrow}
              disabled={isLoading || (solanaWallet.connected && !solanaWallet.programReady)}
              className="w-full py-4 rounded-2xl text-[17px] font-semibold bg-white/10 text-white flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {escrowTxStatus === 'signing' && (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Sign in Wallet...
                </>
              )}
              {escrowTxStatus === 'confirming' && (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Confirming...
                </>
              )}
              {escrowTxStatus === 'recording' && (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Recording...
                </>
              )}
              {(escrowTxStatus === 'idle' || escrowTxStatus === 'error' || escrowTxStatus === 'connecting') && (
                solanaWallet.connected
                  ? (solanaWallet.programReady ? "Confirm & Lock" : "Wallet Not Ready")
                  : "Connect Wallet to Lock"
              )}
            </motion.button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
