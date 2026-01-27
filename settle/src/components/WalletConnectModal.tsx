'use client';

import WalletModal from './WalletModal';

interface WalletConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: (walletAddress: string) => void;
}

/**
 * User-facing wallet connection modal (purple theme)
 * This is a backwards-compatible wrapper around the unified WalletModal
 */
export default function WalletConnectModal(props: WalletConnectModalProps) {
  return (
    <WalletModal
      {...props}
      theme="user"
      walletFilter={['Phantom', 'Solflare', 'Torus', 'Ledger', 'Coinbase Wallet', 'WalletConnect']}
      showMobileOptions={true}
    />
  );
}
