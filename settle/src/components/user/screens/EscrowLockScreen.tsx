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
  Building2,
  Smartphone,
} from "lucide-react";
import type { Screen } from "./types";
import { BankAccountSelector, type SelectedBankDetails } from "@/components/user/BankAccountSelector";
import type { PaymentMethodItem } from "@/components/user/PaymentMethodSelector";

const CARD = "bg-surface-card border border-border-subtle";

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
  selectedPaymentMethod?: PaymentMethodItem | null;
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
  selectedPaymentMethod,
  userId,
  setShowWalletModal,
  onConnectWallet,
  solanaWallet,
}: EscrowLockScreenProps) => {
  const handleConnectWallet = onConnectWallet || (() => setShowWalletModal(true));
  return (
    <div className="bg-surface-base min-h-full">
      <div className="h-12" />

      <div className="px-5 py-4 flex items-center">
        <button onClick={() => { setScreen("home"); setEscrowTxStatus('idle'); setEscrowError(null); }}
          className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1 bg-surface-raised border border-border-subtle">
          <ChevronLeft className="w-5 h-5 text-text-primary" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold pr-8 text-text-primary">Confirm Escrow</h1>
      </div>

      <div className="px-5 flex flex-col gap-4 pb-10">
        {/* Header */}
        <div className="flex items-center gap-4 py-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-surface-raised">
            <Shield className="w-7 h-7 text-text-primary" />
          </div>
          <div>
            <h2 className="text-[22px] font-bold text-text-primary">Lock {parseFloat(amount).toFixed(2)} USDT</h2>
            <p className="text-[13px] text-text-secondary">
              Held securely on Solana until you confirm payment
            </p>
          </div>
        </div>

        {/* Wallet Status */}
        <div className={`w-full rounded-2xl p-4 ${CARD}`}>
          <div className="flex items-center justify-between">
            <span className="text-[15px] text-text-secondary">Wallet</span>
            {solanaWallet.connected ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success" />
                <span className="text-[14px] font-mono text-text-primary">
                  {solanaWallet.walletAddress?.slice(0, 4)}...{solanaWallet.walletAddress?.slice(-4)}
                </span>
              </div>
            ) : (
              <button
                onClick={handleConnectWallet}
                className="text-[14px] font-medium text-text-secondary"
              >
                Connect Wallet
              </button>
            )}
          </div>
          {solanaWallet.connected && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-subtle">
              <span className="text-[15px] text-text-secondary">Balance</span>
              <span className={`text-[15px] font-medium ${
                solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance >= parseFloat(amount || '0')
                  ? 'text-text-primary'
                  : 'text-error'
              }`}>
                {solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '...'} USDT
              </span>
            </div>
          )}
        </div>

        {/* Order Details */}
        <div className={`w-full rounded-2xl p-4 space-y-3 ${CARD}`}>
          <div className="flex items-center justify-between">
            <span className="text-[15px] text-text-secondary">Amount to Lock</span>
            <span className="text-[15px] font-medium text-text-primary">{parseFloat(amount).toFixed(2)} USDT</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[15px] text-text-secondary">You&apos;ll receive</span>
            <span className="text-[15px] font-medium text-text-primary">{'\u062F.\u0625'} {parseFloat(fiatAmount).toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[15px] text-text-secondary">Rate</span>
            <span className="text-[15px] text-text-secondary">1 USDT = {currentRate} AED</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[15px] text-text-secondary">Network</span>
            <span className="text-[14px] text-text-secondary">Solana Devnet</span>
          </div>
        </div>

        {/* Payment Method Display */}
        <div className="w-full">
          {selectedPaymentMethod ? (
            <div className="w-full">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="w-4 h-4 text-text-tertiary" />
                <span className="text-[12px] uppercase tracking-wide font-semibold text-text-tertiary">
                  Your Payment Method
                </span>
              </div>
              <div className={`w-full rounded-xl p-3 flex items-center gap-3 ${CARD}`}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-surface-card">
                  {selectedPaymentMethod.type === 'upi' ? (
                    <Smartphone className="w-4 h-4 text-text-secondary" />
                  ) : (
                    <Building2 className="w-4 h-4 text-text-secondary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium truncate text-text-primary">
                    {selectedPaymentMethod.label}
                  </p>
                  <p className="text-[12px] truncate text-text-tertiary">
                    {selectedPaymentMethod.type === 'bank'
                      ? `${selectedPaymentMethod.details.account_name || ''} · ${selectedPaymentMethod.details.iban ? selectedPaymentMethod.details.iban.slice(0, 4) + '...' + selectedPaymentMethod.details.iban.slice(-4) : ''}`
                      : selectedPaymentMethod.type === 'upi'
                      ? selectedPaymentMethod.details.upi_id || ''
                      : Object.values(selectedPaymentMethod.details).filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Lock className="w-4 h-4 shrink-0 text-text-tertiary" />
              </div>
            </div>
          ) : (
            <BankAccountSelector
              userId={userId}
              selected={selectedBankDetails}
              onSelect={setSelectedBankDetails}
            />
          )}
        </div>

        {/* Program Not Ready Warning */}
        {solanaWallet.connected && !solanaWallet.programReady && (
          <div className="w-full rounded-xl p-4 bg-warning-dim border border-warning-border">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div className="text-left flex-1">
                <p className="text-[14px] font-medium text-warning">Wallet Needs Reconnection</p>
                <p className="text-[13px] mt-1 text-text-secondary">
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
                className="flex-1 py-2 rounded-lg text-[14px] font-medium bg-accent text-accent-text"
              >
                Reconnect Wallet
              </button>
              <button
                onClick={() => solanaWallet.reinitializeProgram()}
                className="py-2 px-4 rounded-lg text-[14px] bg-surface-card text-text-secondary"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Error Message */}
        {escrowError && (
          <div className="w-full rounded-xl p-4 bg-error-dim border border-error-border">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-error shrink-0 mt-0.5" />
              <div className="text-left">
                <p className="text-[14px] text-error font-medium">Transaction Failed</p>
                <p className="text-[13px] mt-1 text-text-secondary">{escrowError}</p>
              </div>
            </div>
            <button
              onClick={() => { setEscrowError(null); setEscrowTxStatus('idle'); }}
              className="w-full mt-3 py-2 rounded-lg text-[14px] bg-surface-card text-text-secondary"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Show waiting state after success */}
        {escrowTxStatus === 'success' ? (
          <div className="space-y-4">
            <div className="rounded-2xl p-4 bg-success-dim border border-success-border">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-success-dim">
                  <Lock className="w-5 h-5 text-success" />
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-success">Escrow Locked</p>
                  <p className="text-[13px] text-text-secondary">Your USDC is secured on-chain</p>
                </div>
              </div>
              {escrowTxHash && (
                <a
                  href={`https://explorer.solana.com/tx/${escrowTxHash}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[13px] text-success hover:text-success"
                >
                  View Transaction <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <div className={`rounded-2xl p-4 ${CARD}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-border-medium">
                  <Clock className="w-5 h-5 text-text-secondary" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-medium text-text-primary">Waiting for merchant</p>
                  <p className="text-[13px] text-text-tertiary">Merchant will accept and send fiat to your bank</p>
                </div>
              </div>
              <div className="mt-3 h-1 rounded-full overflow-hidden bg-surface-card">
                <motion.div
                  className="h-full w-[30%] bg-border-medium"
                  animate={{ x: ["-100%", "100%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                />
              </div>
            </div>

            <button
              onClick={() => setScreen("order")}
              className="w-full py-3 rounded-xl text-[15px] font-medium bg-accent text-accent-text"
            >
              View Order Details
            </button>
          </div>
        ) : (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={solanaWallet.connected ? confirmEscrow : handleConnectWallet}
            disabled={isLoading || (solanaWallet.connected && !solanaWallet.programReady)}
            className="w-full py-4 rounded-2xl text-[17px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 bg-accent text-accent-text"
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
        )}
      </div>
    </div>
  );
};
