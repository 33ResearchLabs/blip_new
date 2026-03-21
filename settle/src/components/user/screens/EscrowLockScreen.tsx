"use client";

import { motion } from "framer-motion";
import {
  ChevronLeft,
  Shield,
  AlertTriangle,
  Loader2,
  Lock,
  Clock,
  ExternalLink,
} from "lucide-react";
import type { Screen } from "./types";
import { BankAccountSelector, type SelectedBankDetails } from "@/components/user/BankAccountSelector";

export interface EscrowLockScreenProps {
  setScreen: (s: Screen) => void;
  amount: string;
  fiatAmount: string;
  currentRate: number;
  escrowTxStatus: 'idle' | 'connecting' | 'signing' | 'confirming' | 'recording' | 'success' | 'error';
  setEscrowTxStatus: (s: 'idle' | 'connecting' | 'signing' | 'confirming' | 'recording' | 'success' | 'error') => void;
  escrowTxHash: string | null;
  escrowError: string | null;
  setEscrowError: (e: string | null) => void;
  isLoading: boolean;
  confirmEscrow: () => void;
  selectedBankDetails: SelectedBankDetails | null;
  setSelectedBankDetails: (v: SelectedBankDetails | null) => void;
  userId: string | null;
  setShowWalletModal: (v: boolean) => void;
  onConnectWallet?: () => void;
  solanaWallet: {
    connected: boolean;
    walletAddress: string | null;
    usdtBalance: number | null;
    programReady: boolean;
    disconnect: () => void;
    reinitializeProgram: () => void;
  };
}

export const EscrowLockScreen = ({
  setScreen,
  amount,
  fiatAmount,
  currentRate,
  escrowTxStatus,
  setEscrowTxStatus,
  escrowTxHash,
  escrowError,
  setEscrowError,
  isLoading,
  confirmEscrow,
  selectedBankDetails,
  setSelectedBankDetails,
  userId,
  setShowWalletModal,
  onConnectWallet,
  solanaWallet,
}: EscrowLockScreenProps) => {
  const handleConnectWallet = onConnectWallet || (() => setShowWalletModal(true));
  return (
    <>
      <div className="h-12" />

      <div className="px-5 py-4 flex items-center">
        <button onClick={() => { setScreen("home"); setEscrowTxStatus('idle'); setEscrowError(null); }} className="p-2 -ml-2">
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-white pr-8">Confirm Escrow</h1>
      </div>

      <div className="flex-1 px-5 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6">
            <Shield className="w-10 h-10 text-white/70" />
          </div>
          <h2 className="text-[22px] font-semibold text-white mb-2">Lock {amount} USDT</h2>
          <p className="text-[15px] text-neutral-500 mb-6 max-w-[280px]">
            Your USDT will be held securely on Solana until you confirm receiving payment
          </p>

          {/* Wallet Status */}
          <div className="w-full bg-neutral-900 rounded-2xl p-4 mb-4">
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
                  onClick={handleConnectWallet}
                  className="text-[14px] text-white/70 font-medium"
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
          <div className="w-full bg-neutral-900 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-neutral-500">Amount to Lock</span>
              <span className="text-[15px] font-medium text-white">{amount} USDT</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-neutral-500">You&apos;ll receive</span>
              <span className="text-[15px] font-medium text-white">{'\u062F.\u0625'} {parseFloat(fiatAmount).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-neutral-500">Rate</span>
              <span className="text-[15px] text-neutral-400">1 USDT = {currentRate} AED</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-neutral-500">Network</span>
              <span className="text-[14px] text-white/70">Solana Devnet</span>
            </div>
          </div>

          {/* Bank Account Selector */}
          <div className="w-full mt-2">
            <BankAccountSelector
              userId={userId}
              selected={selectedBankDetails}
              onSelect={setSelectedBankDetails}
            />
          </div>

          {/* Program Not Ready Warning */}
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
                    setTimeout(handleConnectWallet, 100);
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

            <div className="bg-neutral-900 rounded-2xl p-4">
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
              onClick={solanaWallet.connected ? confirmEscrow : handleConnectWallet}
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
    </>
  );
};
