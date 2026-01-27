'use client';

import WalletModal from './WalletModal';

interface MerchantWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: (walletAddress: string) => void;
}

/**
 * Merchant-facing wallet connection modal (gold theme)
 * This is a backwards-compatible wrapper around the unified WalletModal
 */
export default function MerchantWalletModal(props: MerchantWalletModalProps) {
  return (
    <WalletModal
      {...props}
      theme="merchant"
      walletFilter={['Phantom', 'Solflare']}
      showMobileOptions={true}
    />
  );
}
