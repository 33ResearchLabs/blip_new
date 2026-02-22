'use client';

import { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { MOCK_MODE } from '@/lib/config/mockMode';

const EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

// Dynamically import the appropriate wallet provider:
// 1. MOCK_MODE=true → MockWalletProvider (DB-backed fake USDT, no Solana)
// 2. EMBEDDED_WALLET=true → EmbeddedWalletProvider (in-app Keypair, on-chain devnet)
// 3. Default → SolanaWalletProvider (Phantom/Solflare external wallets)
const WalletProvider = dynamic(
  () => {
    if (MOCK_MODE) {
      return import('@/context/MockWalletContext').then(mod => ({ default: mod.MockWalletProvider }));
    }
    if (EMBEDDED_WALLET) {
      return import('@/context/EmbeddedWalletContext').then(mod => ({ default: mod.EmbeddedWalletProvider }));
    }
    return import('@/context/SolanaWalletContext').then(mod => ({ default: mod.SolanaWalletProvider }));
  },
  { ssr: false }
);

export default function ClientWalletProvider({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      {children}
    </WalletProvider>
  );
}
