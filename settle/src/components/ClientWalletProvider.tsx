'use client';

import { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { MOCK_MODE } from '@/lib/config/mockMode';

// Dynamically import the appropriate wallet provider based on mock mode
// When MOCK_MODE=true: Uses MockWalletProvider (DB-backed fake USDT, no Solana)
// When MOCK_MODE=false: Uses real SolanaWalletProvider (on-chain wallets)
const WalletProvider = dynamic(
  () => MOCK_MODE
    ? import('@/context/MockWalletContext').then(mod => ({ default: mod.MockWalletProvider }))
    : import('@/context/SolanaWalletContext').then(mod => ({ default: mod.SolanaWalletProvider })),
  { ssr: false }
);

export default function ClientWalletProvider({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      {children}
    </WalletProvider>
  );
}
