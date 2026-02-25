'use client';

/**
 * useEscrowRelease — UI state wrapper for releasing escrow
 *
 * Handles loading / error / success state for the release call.
 * Does NOT build on-chain transactions — that's lib/solana's job.
 */

import { useState, useCallback } from 'react';
import { releaseEscrow, type EscrowReleaseParams } from '../services/escrow.service';

interface UseEscrowReleaseReturn {
  release: (params: EscrowReleaseParams) => Promise<unknown>;
  isLoading: boolean;
  error: string | null;
  isSuccess: boolean;
  reset: () => void;
}

export function useEscrowRelease(): UseEscrowReleaseReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const reset = useCallback(() => {
    setError(null);
    setIsSuccess(false);
  }, []);

  const release = useCallback(async (params: EscrowReleaseParams) => {
    setIsLoading(true);
    setError(null);
    setIsSuccess(false);

    try {
      const result = await releaseEscrow(params);
      setIsSuccess(true);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to release escrow';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { release, isLoading, error, isSuccess, reset };
}
