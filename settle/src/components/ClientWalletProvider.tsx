'use client';

import dynamic from 'next/dynamic';
import { MOCK_MODE } from '@/lib/config/mockMode';

const EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

// Dynamically import the appropriate wallet provider:
// 1. MOCK_MODE=true → MockWalletProvider (DB-backed fake USDT, no Solana)
// 2. EMBEDDED_WALLET=true → EmbeddedWalletProvider (in-app Keypair, on-chain devnet)
// 3. Default → SolanaWalletProvider (Phantom/Solflare external wallets)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WalletProvider: any = dynamic(
  (() => {
    if (MOCK_MODE) {
      return import('@/context/MockWalletContext').then(mod => ({ default: mod.MockWalletProvider }));
    }
    if (EMBEDDED_WALLET) {
      return import('@/context/EmbeddedWalletContext').then(mod => ({ default: mod.EmbeddedWalletProvider }));
    }
    return import('@/context/SolanaWalletContext').then(mod => ({ default: mod.SolanaWalletProvider }));
  }) as any,
  { ssr: false }
);

export default function ClientWalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      {children}
    </WalletProvider>
  );
}
