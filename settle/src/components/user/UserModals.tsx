"use client";

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
    actorId: string | null;
    setActorId: (id: string | null) => void;
    unlockWallet: (password: string) => Promise<boolean>;
    migrateToPin?: (oldPassword: string, newPin: string) => Promise<boolean>;
    lockWallet: () => void;
    deleteWallet: () => void;
    setKeypairAndUnlock: (kp: any) => void;
  } | undefined;
  solanaWallet: any;
  showUsernameModal: boolean;
  handleWalletUsername: (username: string) => Promise<void>;
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
          onMigrateToPin={
            embeddedWallet.migrateToPin
              ? async (oldPassword, newPin) => {
                  const ok = await embeddedWallet.migrateToPin!(oldPassword, newPin);
                  if (ok) setShowWalletUnlock(false);
                  return ok;
                }
              : undefined
          }
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
              actorId={embeddedWallet.actorId}
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

    </>
  );
}
