'use client';

import dynamic from 'next/dynamic';

// Compliance always uses real Phantom/external wallets regardless of
// NEXT_PUBLIC_EMBEDDED_WALLET — the DAO wallet must sign on-chain dispute resolutions.
const SolanaWalletProvider = dynamic(
  () => import('@/context/SolanaWalletContext').then(mod => ({ default: mod.SolanaWalletProvider })),
  { ssr: false }
);

export default function ComplianceWalletProvider({ children }: { children: React.ReactNode }) {
  return <SolanaWalletProvider>{children}</SolanaWalletProvider>;
}
