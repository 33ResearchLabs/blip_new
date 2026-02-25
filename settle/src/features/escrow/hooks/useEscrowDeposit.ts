'use client';

/**
 * useEscrowDeposit — UI state wrapper for locking escrow
 *
 * Handles loading / error / success state for the deposit call.
 * Does NOT determine who pays escrow — that's the API's job.
 * Does NOT build on-chain transactions — that's lib/solana's job.
 */

import { useState, useCallback } from 'react';
import { depositEscrow, type EscrowDepositParams } from '../services/escrow.service';

interface UseEscrowDepositReturn {
  deposit: (params: EscrowDepositParams) => Promise<unknown>;
  isLoading: boolean;
  error: string | null;
  isSuccess: boolean;
  reset: () => void;
}

export function useEscrowDeposit(): UseEscrowDepositReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const reset = useCallback(() => {
    setError(null);
    setIsSuccess(false);
  }, []);

  const deposit = useCallback(async (params: EscrowDepositParams) => {
    setIsLoading(true);
    setError(null);
    setIsSuccess(false);

    try {
      const result = await depositEscrow(params);
      setIsSuccess(true);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to deposit escrow';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { deposit, isLoading, error, isSuccess, reset };
}
