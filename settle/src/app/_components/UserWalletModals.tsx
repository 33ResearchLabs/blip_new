"use client";

import dynamic from "next/dynamic";

const WalletConnectModal = dynamic(() => import("@/components/WalletConnectModal"), { ssr: false });
const UsernameModal = dynamic(() => import("@/components/UsernameModal"), { ssr: false });
const UnlockWalletPrompt = dynamic(() => import("@/components/wallet/UnlockWalletPrompt").then(mod => ({ default: mod.UnlockWalletPrompt })), { ssr: false });
const EmbeddedWalletSetup = dynamic(() => import("@/components/wallet/EmbeddedWalletSetup").then(mod => ({ default: mod.EmbeddedWalletSetup })), { ssr: false });

interface UserWalletModalsProps {
  IS_EMBEDDED_WALLET: boolean;
  showWalletModal: boolean;
  setShowWalletModal: (s: boolean) => void;
  handleSolanaWalletConnect: (addr: string) => void;
  showWalletUnlock: boolean;
  setShowWalletUnlock: (s: boolean) => void;
  showWalletSetup: boolean;
  setShowWalletSetup: (s: boolean) => void;
  showUsernameModal: boolean;
  handleWalletUsername: (username: string) => Promise<void>;
  solanaWallet: any;
  embeddedWallet: any;
}

export function UserWalletModals({
  IS_EMBEDDED_WALLET, showWalletModal, setShowWalletModal,
  handleSolanaWalletConnect, showWalletUnlock, setShowWalletUnlock,
  showWalletSetup, setShowWalletSetup, showUsernameModal,
  handleWalletUsername, solanaWallet, embeddedWallet,
}: UserWalletModalsProps) {
  return (
    <>
      {/* Solana Wallet Connect Modal (external wallets only) */}
      {!IS_EMBEDDED_WALLET && (
        <WalletConnectModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
          onConnected={handleSolanaWalletConnect}
        />
      )}

      {/* Embedded Wallet: Unlock Prompt */}
      {IS_EMBEDDED_WALLET && showWalletUnlock && embeddedWallet && (
        <UnlockWalletPrompt
          onUnlock={async (password) => {
            const ok = await embeddedWallet.unlockWallet(password);
            if (ok) setShowWalletUnlock(false);
            return ok;
          }}
          onClose={() => setShowWalletUnlock(false)}
        />
      )}

      {/* Embedded Wallet: Setup (Create / Import) */}
      {IS_EMBEDDED_WALLET && showWalletSetup && embeddedWallet && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0d0d0d] rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl overflow-hidden">
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

      {/* Username Modal for New Wallet Users */}
      {solanaWallet.walletAddress && (
        <UsernameModal
          isOpen={showUsernameModal}
          walletAddress={solanaWallet.walletAddress}
          onSubmit={handleWalletUsername}
          canClose={false}
        />
      )}
    </>
  );
}
