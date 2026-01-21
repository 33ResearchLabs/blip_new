'use client';

import { ReactNode } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import SolanaWalletProvider with SSR disabled
const SolanaWalletProvider = dynamic(
  () => import('@/context/SolanaWalletContext').then(mod => mod.SolanaWalletProvider),
  { ssr: false }
);

export default function ClientWalletProvider({ children }: { children: ReactNode }) {
  return (
    <SolanaWalletProvider>
      {children}
    </SolanaWalletProvider>
  );
}
