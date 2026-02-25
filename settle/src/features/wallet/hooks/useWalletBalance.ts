'use client';

/**
 * useWalletBalance — UI state wrapper for on-chain balance queries
 *
 * Provides loading / error state around balance.service calls.
 */

import { useState, useCallback } from 'react';
import { getWalletBalance, type BalanceResult } from '../services/balance.service';

interface UseWalletBalanceReturn {
  balance: BalanceResult | null;
  isLoading: boolean;
  error: string | null;
  fetch: (walletAddress: string, network?: 'devnet' | 'mainnet-beta') => Promise<void>;
}

export function useWalletBalance(): UseWalletBalanceReturn {
  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(
    async (walletAddress: string, network: 'devnet' | 'mainnet-beta' = 'devnet') => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await getWalletBalance(walletAddress, network);
        setBalance(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch balance');
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { balance, isLoading, error, fetch };
}
