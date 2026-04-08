"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Check } from "lucide-react";
import dynamic from "next/dynamic";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

const WalletConnectModal = dynamic(() => import("@/components/WalletConnectModal"), { ssr: false });
const UsernameModal = dynamic(() => import("@/components/UsernameModal"), { ssr: false });
const UnlockWalletPrompt = dynamic(() => import("@/components/wallet/UnlockWalletPrompt").then(mod => ({ default: mod.UnlockWalletPrompt })), { ssr: false });
const EmbeddedWalletSetup = dynamic(() => import("@/components/wallet/EmbeddedWalletSetup").then(mod => ({ default: mod.EmbeddedWalletSetup })), { ssr: false });

interface UserModalsProps {
  showWalletModal: boolean;
  setShowWalletModal: (show: boolean) => void;
  handleSolanaWalletConnect: (address: string) => void;
  showWalletUnlock: boolean;
  setShowWalletUnlock: (show: boolean) => void;
  showWalletSetup: boolean;
  setShowWalletSetup: (show: boolean) => void;
  embeddedWallet: {
    state: 'none' | 'locked' | 'unlocked';
    unlockWallet: (password: string) => Promise<boolean>;
    lockWallet: () => void;
    deleteWallet: () => void;
    setKeypairAndUnlock: (kp: any) => void;
  } | undefined;
  solanaWallet: any;
  showUsernameModal: boolean;
  handleWalletUsername: (username: string) => Promise<void>;
  showAcceptancePopup: boolean;
  setShowAcceptancePopup: (show: boolean) => void;
  acceptedOrderInfo: {
    merchantName: string;
    cryptoAmount: number;
    fiatAmount: number;
    orderType: 'buy' | 'sell';
  } | null;
}

export function UserModals({
  showWalletModal,
  setShowWalletModal,
  handleSolanaWalletConnect,
  showWalletUnlock,
  setShowWalletUnlock,
  showWalletSetup,
  setShowWalletSetup,
  embeddedWallet,
  solanaWallet,
  showUsernameModal,
  handleWalletUsername,
  showAcceptancePopup,
  setShowAcceptancePopup,
  acceptedOrderInfo,
}: UserModalsProps) {
  return (
    <>
      {!IS_EMBEDDED_WALLET && (
        <WalletConnectModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
          onConnected={handleSolanaWalletConnect}
        />
      )}

      {IS_EMBEDDED_WALLET && showWalletUnlock && embeddedWallet && (
        <UnlockWalletPrompt
          onUnlock={async (password) => {
            const ok = await embeddedWallet.unlockWallet(password);
            if (ok) setShowWalletUnlock(false);
            return ok;
          }}
          onForgotPassword={() => {
            setShowWalletUnlock(false);
            setShowWalletSetup(true);
          }}
          onCreateNew={() => {
            localStorage.removeItem('blip_embedded_wallet');
            localStorage.removeItem('blip_wallet');
            localStorage.removeItem('blip_user');
            setShowWalletUnlock(false);
            setShowWalletSetup(true);
          }}
          onClose={() => setShowWalletUnlock(false)}
        />
      )}

      {IS_EMBEDDED_WALLET && showWalletSetup && embeddedWallet && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden bg-surface-base border border-border-subtle">
            <EmbeddedWalletSetup
              onWalletCreated={(kp) => {
                embeddedWallet.setKeypairAndUnlock(kp);
                setShowWalletSetup(false);
              }}
              onClose={() => setShowWalletSetup(false)}
            />
          </div>
        </div>
      )}

      {solanaWallet.walletAddress && (
        <UsernameModal
          isOpen={showUsernameModal}
          walletAddress={solanaWallet.walletAddress}
          onSubmit={handleWalletUsername}
          canClose={false}
        />
      )}

      <AnimatePresence>
        {showAcceptancePopup && acceptedOrderInfo && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm"
          >
            <div className="rounded-2xl p-4 shadow-xl bg-surface-base border border-border-subtle">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-surface-active">
                  <Check className="w-5 h-5 text-text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold mb-1 text-text-primary">Order Accepted!</p>
                  <p className="text-xs mb-2 text-text-secondary">
                    <span className="font-semibold text-text-primary">{acceptedOrderInfo.merchantName}</span> accepted your {acceptedOrderInfo.orderType === 'sell' ? 'sell' : 'buy'} order
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-text-primary">{acceptedOrderInfo.cryptoAmount} USDC</span>
                    <span className="text-text-quaternary">{'\u2022'}</span>
                    <span className="text-text-secondary">{acceptedOrderInfo.fiatAmount.toLocaleString()} AED</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowAcceptancePopup(false)}
                  className="p-1 rounded-lg bg-surface-card"
                >
                  <X className="w-4 h-4 text-text-tertiary" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
