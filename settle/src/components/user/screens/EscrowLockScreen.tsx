"use client";

import { motion } from "framer-motion";
import { colors, sectionLabel, mono } from "@/lib/design/theme";
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
    <div style={{ background: colors.bg.primary, minHeight: '100%' }}>
      <div className="h-12" />

      <div className="px-5 py-4 flex items-center">
        <button onClick={() => { setScreen("home"); setEscrowTxStatus('idle'); setEscrowError(null); }}
          className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1"
          style={{ background: colors.bg.secondary, border: `1px solid ${colors.border.subtle}` }}>
          <ChevronLeft className="w-5 h-5" style={{ color: colors.text.primary }} />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold pr-8" style={{ color: colors.text.primary }}>Confirm Escrow</h1>
      </div>

      <div className="px-5 flex flex-col gap-4 pb-10">
        {/* Header */}
        <div className="flex items-center gap-4 py-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: colors.bg.secondary }}>
            <Shield className="w-7 h-7" style={{ color: colors.text.primary }} />
          </div>
          <div>
            <h2 className="text-[22px] font-bold" style={{ color: colors.text.primary }}>Lock {parseFloat(amount).toFixed(2)} USDT</h2>
            <p className="text-[13px]" style={{ color: colors.text.secondary }}>
              Held securely on Solana until you confirm payment
            </p>
          </div>
        </div>

        {/* Wallet Status */}
        <div className="w-full rounded-2xl p-4" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
          <div className="flex items-center justify-between">
            <span className="text-[15px]" style={{ color: colors.text.secondary }}>Wallet</span>
            {solanaWallet.connected ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: '#10b981' }} />
                <span className="text-[14px] font-mono" style={{ color: colors.text.primary }}>
                  {solanaWallet.walletAddress?.slice(0, 4)}...{solanaWallet.walletAddress?.slice(-4)}
                </span>
              </div>
            ) : (
              <button
                onClick={handleConnectWallet}
                className="text-[14px] font-medium" style={{ color: colors.text.secondary }}
              >
                Connect Wallet
              </button>
            )}
          </div>
          {solanaWallet.connected && (
            <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: `1px solid ${colors.border.subtle}` }}>
              <span className="text-[15px]" style={{ color: colors.text.secondary }}>Balance</span>
              <span className={`text-[15px] font-medium ${
                solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance >= parseFloat(amount || '0')
                  ? ''
                  : 'text-red-400'
              }`} style={solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance >= parseFloat(amount || '0') ? { color: colors.text.primary } : {}}>
                {solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '...'} USDT
              </span>
            </div>
          )}
        </div>

        {/* Order Details */}
        <div className="w-full rounded-2xl p-4 space-y-3" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
          <div className="flex items-center justify-between">
            <span className="text-[15px]" style={{ color: colors.text.secondary }}>Amount to Lock</span>
            <span className="text-[15px] font-medium" style={{ color: colors.text.primary }}>{parseFloat(amount).toFixed(2)} USDT</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[15px]" style={{ color: colors.text.secondary }}>You&apos;ll receive</span>
            <span className="text-[15px] font-medium" style={{ color: colors.text.primary }}>{'\u062F.\u0625'} {parseFloat(fiatAmount).toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[15px]" style={{ color: colors.text.secondary }}>Rate</span>
            <span className="text-[15px]" style={{ color: colors.text.secondary }}>1 USDT = {currentRate} AED</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[15px]" style={{ color: colors.text.secondary }}>Network</span>
            <span className="text-[14px]" style={{ color: colors.text.secondary }}>Solana Devnet</span>
          </div>
        </div>

        {/* Payment Method Display */}
        <div className="w-full">
          {selectedPaymentMethod ? (
            <div className="w-full">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="w-4 h-4" style={{ color: colors.text.tertiary }} />
                <span className="text-[12px] uppercase tracking-wide font-semibold" style={{ color: colors.text.tertiary }}>
                  Your Payment Method
                </span>
              </div>
              <div className="w-full rounded-xl p-3 flex items-center gap-3" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: colors.surface.card }}>
                  {selectedPaymentMethod.type === 'upi' ? (
                    <Smartphone className="w-4 h-4" style={{ color: colors.text.secondary }} />
                  ) : (
                    <Building2 className="w-4 h-4" style={{ color: colors.text.secondary }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium truncate" style={{ color: colors.text.primary }}>
                    {selectedPaymentMethod.label}
                  </p>
                  <p className="text-[12px] truncate" style={{ color: colors.text.tertiary }}>
                    {selectedPaymentMethod.type === 'bank'
                      ? `${selectedPaymentMethod.details.account_name || ''} · ${selectedPaymentMethod.details.iban ? selectedPaymentMethod.details.iban.slice(0, 4) + '...' + selectedPaymentMethod.details.iban.slice(-4) : ''}`
                      : selectedPaymentMethod.type === 'upi'
                      ? selectedPaymentMethod.details.upi_id || ''
                      : Object.values(selectedPaymentMethod.details).filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Lock className="w-4 h-4 shrink-0" style={{ color: colors.text.tertiary }} />
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
          <div className="w-full rounded-xl p-4" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="text-left flex-1">
                <p className="text-[14px] font-medium text-yellow-600">Wallet Needs Reconnection</p>
                <p className="text-[13px] mt-1" style={{ color: colors.text.secondary }}>
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
                className="flex-1 py-2 rounded-lg text-[14px] font-medium"
                style={{ background: colors.accent.primary, color: colors.accent.text }}
              >
                Reconnect Wallet
              </button>
              <button
                onClick={() => solanaWallet.reinitializeProgram()}
                className="py-2 px-4 rounded-lg text-[14px]"
                style={{ background: colors.surface.card, color: colors.text.secondary }}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Error Message */}
        {escrowError && (
          <div className="w-full rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-left">
                <p className="text-[14px] text-red-500 font-medium">Transaction Failed</p>
                <p className="text-[13px] mt-1" style={{ color: colors.text.secondary }}>{escrowError}</p>
              </div>
            </div>
            <button
              onClick={() => { setEscrowError(null); setEscrowTxStatus('idle'); }}
              className="w-full mt-3 py-2 rounded-lg text-[14px]"
              style={{ background: colors.surface.card, color: colors.text.secondary }}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Show waiting state after success */}
        {escrowTxStatus === 'success' ? (
          <div className="space-y-4">
            <div className="rounded-2xl p-4" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}>
                  <Lock className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-green-700">Escrow Locked</p>
                  <p className="text-[13px]" style={{ color: colors.text.secondary }}>Your USDC is secured on-chain</p>
                </div>
              </div>
              {escrowTxHash && (
                <a
                  href={`https://explorer.solana.com/tx/${escrowTxHash}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[13px] text-green-600 hover:text-green-700"
                >
                  View Transaction <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <div className="rounded-2xl p-4" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: colors.border.medium }}>
                  <Clock className="w-5 h-5" style={{ color: colors.text.secondary }} />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-medium" style={{ color: colors.text.primary }}>Waiting for merchant</p>
                  <p className="text-[13px]" style={{ color: colors.text.tertiary }}>Merchant will accept and send fiat to your bank</p>
                </div>
              </div>
              <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: colors.surface.card }}>
                <motion.div
                  className="h-full"
                  style={{ background: colors.border.medium, width: "30%" }}
                  animate={{ x: ["-100%", "100%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                />
              </div>
            </div>

            <button
              onClick={() => setScreen("order")}
              className="w-full py-3 rounded-xl text-[15px] font-medium"
              style={{ background: colors.accent.primary, color: colors.accent.text }}
            >
              View Order Details
            </button>
          </div>
        ) : (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={solanaWallet.connected ? confirmEscrow : handleConnectWallet}
            disabled={isLoading || (solanaWallet.connected && !solanaWallet.programReady)}
            className="w-full py-4 rounded-2xl text-[17px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: colors.accent.primary, color: colors.accent.text }}
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
